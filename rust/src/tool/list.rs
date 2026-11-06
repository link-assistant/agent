//! List (ls) tool implementation
//!
//! Lists directory contents with ignore patterns and tree structure output,
//! matching the JavaScript implementation's list tool, which lists files
//! with `rg --files --hidden` and excludes `IGNORE_PATTERNS` as `!<p>*`
//! globs:
//!
//! - the built-in patterns are rg globs relative to the listed directory
//!   (`node_modules/` excludes the top-level `node_modules`), `ignore`
//!   entries are added as `!<pattern>`;
//! - `.gitignore`/`.ignore` rules apply, dotfiles are listed, `.git` is
//!   skipped and symlinks are not followed;
//! - at most 100 files; `truncated` is set when the limit is reached and no
//!   note is added to the tree;
//! - a missing path or a path that is not a directory is an error with the
//!   JS message.
//!
//! `LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT=true` restores the earlier
//! listing: the built-in names excluded at any depth, no ignore files, the
//! truncation note, the earlier errors and `.` as title of the working
//! directory.

use async_trait::async_trait;
use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use walkdir::WalkDir;

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// JS `IGNORE_PATTERNS`, each excluded as the rg glob `!<pattern>*`
pub const IGNORE_PATTERNS: &[&str] = &[
    "node_modules/",
    "__pycache__/",
    ".git/",
    "dist/",
    "build/",
    "target/",
    "vendor/",
    "bin/",
    "obj/",
    ".idea/",
    ".vscode/",
    ".zig-cache/",
    "zig-out",
    ".coverage",
    "coverage/",
    "tmp/",
    "temp/",
    ".cache/",
    "cache/",
    "logs/",
    ".venv/",
    "venv/",
    "env/",
];

/// Names excluded at any depth by the earlier listing (legacy output)
const DEFAULT_IGNORE_PATTERNS: &[&str] = &[
    "node_modules",
    "__pycache__",
    ".git",
    "dist",
    "build",
    "target",
    "vendor",
    "bin",
    "obj",
    ".idea",
    ".vscode",
    ".zig-cache",
    "zig-out",
    ".coverage",
    "coverage",
    "tmp",
    "temp",
    ".cache",
    "cache",
    "logs",
    ".venv",
    "venv",
    "env",
];

/// Maximum files to list
const LIMIT: usize = 100;

/// Tool description
const DESCRIPTION: &str = "Lists files and directories in a given path. The path parameter must be absolute; omit it to use the current workspace directory. You can optionally provide an array of glob patterns to ignore with the ignore parameter. You should generally prefer the Glob and Grep tools, if you know which directories to search.";

/// Parameters for the list tool
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    /// The absolute path to the directory to list
    #[serde(default)]
    pub path: Option<String>,
    /// Additional glob patterns to ignore
    #[serde(default)]
    pub ignore: Option<Vec<String>>,
}

/// List tool implementation
pub struct ListTool;

#[async_trait]
impl Tool for ListTool {
    fn id(&self) -> &'static str {
        "list"
    }

    fn description(&self) -> &'static str {
        DESCRIPTION
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The absolute path to the directory to list (must be absolute, not relative)"
                },
                "ignore": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "List of glob patterns to ignore"
                }
            }
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: ListParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("list", e.to_string()))?;

        let legacy = ctx.settings().legacy_tool_output;

        let dir_path = match &params.path {
            Some(p) if !p.is_empty() => ctx.resolve_path(p),
            _ => ctx.working_directory.clone(),
        };

        if legacy {
            return legacy_list(&params, dir_path, ctx);
        }

        match std::fs::metadata(&dir_path) {
            Err(_) => {
                return Err(AgentError::tool_execution(
                    "list",
                    format!("No such file or directory: '{}'", dir_path.display()),
                ))
            }
            Ok(info) if !info.is_dir() => {
                return Err(AgentError::tool_execution(
                    "list",
                    format!("Search path is not a directory: {}", dir_path.display()),
                ))
            }
            Ok(_) => {}
        }

        let mut globs: Vec<String> = IGNORE_PATTERNS.iter().map(|p| format!("!{}*", p)).collect();
        globs.extend(params.ignore.iter().flatten().map(|p| format!("!{}", p)));

        let cancelled = Arc::new(AtomicBool::new(false));
        let _cancel_on_drop = CancelOnDrop(cancelled.clone());
        let root = dir_path.clone();
        let files = tokio::task::spawn_blocking(move || list_files(&root, &globs, &cancelled))
            .await
            .map_err(|e| AgentError::tool_execution("list", e.to_string()))?
            .map_err(|e| AgentError::tool_execution("list", e))?;

        let output = build_tree_output(&dir_path, &files, false);

        Ok(ToolResult {
            is_error: false,
            title: ctx.relative_path(&dir_path),
            output,
            metadata: json!({
                "count": files.len(),
                "truncated": files.len() >= LIMIT,
            }),
            attachments: None,
        })
    }
}

struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// The first [`LIMIT`] files under `root` (relative, `/`-separated) in
/// file-name order, like `rg --files --hidden` with the exclusion `globs`.
fn list_files(
    root: &Path,
    globs: &[String],
    cancelled: &AtomicBool,
) -> std::result::Result<Vec<String>, String> {
    let mut overrides = OverrideBuilder::new(root);
    for glob in globs {
        overrides
            .add(glob)
            .map_err(|e| format!("Invalid ignore pattern '{}': {}", glob, e))?;
    }
    let overrides = overrides
        .build()
        .map_err(|e| format!("Invalid ignore pattern: {}", e))?;

    let walker = WalkBuilder::new(root)
        .hidden(false)
        .follow_links(false)
        .overrides(overrides)
        .sort_by_file_name(|a, b| a.cmp(b))
        .filter_entry(|entry| entry.depth() == 0 || entry.file_name() != ".git")
        .build();
    let mut files = Vec::new();
    for entry in walker {
        if cancelled.load(Ordering::Relaxed) {
            return Err("List was cancelled".to_string());
        }
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 || !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(root) {
            files.push(rel.to_string_lossy().replace('\\', "/"));
            if files.len() >= LIMIT {
                break;
            }
        }
    }
    Ok(files)
}

/// The earlier listing (legacy tool output).
fn legacy_list(params: &ListParams, dir_path: PathBuf, ctx: &ToolContext) -> Result<ToolResult> {
    let title = ctx.relative_path(&dir_path);

    if !dir_path.exists() {
        return Err(AgentError::file_not_found(
            dir_path.to_string_lossy(),
            vec![],
        ));
    }

    if !dir_path.is_dir() {
        return Err(AgentError::tool_execution(
            "list",
            format!("Not a directory: {}", dir_path.display()),
        ));
    }

    // Build combined ignore list
    let mut ignore_patterns: Vec<String> = DEFAULT_IGNORE_PATTERNS
        .iter()
        .map(|s| s.to_string())
        .collect();
    if let Some(extra) = &params.ignore {
        ignore_patterns.extend(extra.iter().cloned());
    }

    let mut files: Vec<String> = Vec::new();
    let mut truncated = false;

    for entry in WalkDir::new(&dir_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.path() == dir_path {
                return true;
            }
            let name = e.file_name().to_str().unwrap_or("");
            !should_ignore(name, &ignore_patterns)
        })
        .filter_map(|e| e.ok())
    {
        if entry.path() == dir_path {
            continue;
        }
        if entry.file_type().is_file() {
            if let Ok(rel) = entry.path().strip_prefix(&dir_path) {
                files.push(rel.to_string_lossy().replace('\\', "/"));
                if files.len() >= LIMIT {
                    truncated = true;
                    break;
                }
            }
        }
    }

    let output = build_tree_output(&dir_path, &files, truncated);

    Ok(ToolResult {
        is_error: false,
        title: if title.is_empty() {
            ".".to_string()
        } else {
            title
        },
        output,
        metadata: json!({
            "count": files.len(),
            "truncated": truncated,
        }),
        attachments: None,
    })
}

/// Check if a file/directory name should be ignored
pub fn should_ignore(name: &str, patterns: &[String]) -> bool {
    for pattern in patterns {
        // Simple pattern matching: exact name match or prefix match for dirs
        if name == pattern.as_str() {
            return true;
        }
        if name == pattern.trim_end_matches('/') {
            return true;
        }
        // Hidden files/dirs (except . and ..)
        if name.starts_with('.') && name != "." && name != ".." && pattern == ".git" {
            // Only skip .git specifically, not all hidden files
        }
    }
    false
}

/// Build a tree structure output matching the JS list tool output format
fn build_tree_output(root: &Path, files: &[String], truncated: bool) -> String {
    // Organize files by directory
    let mut dirs: BTreeSet<String> = BTreeSet::new();
    let mut files_by_dir: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for file in files {
        let path = std::path::Path::new(file);
        let dir = path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());
        let dir = if dir.is_empty() { ".".to_string() } else { dir };
        let basename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Add all parent directories
        let parts: Vec<&str> = if dir == "." {
            vec![]
        } else {
            dir.split('/').collect()
        };

        dirs.insert(".".to_string());
        for i in 0..parts.len() {
            let dir_path = parts[..=i].join("/");
            dirs.insert(dir_path);
        }
        dirs.insert(dir.clone());

        files_by_dir.entry(dir).or_default().push(basename);
    }

    let mut output = format!("{}/\n", root.display());
    output.push_str(&render_dir(".", &dirs, &files_by_dir, 0));

    if truncated {
        output.push_str(
            "\n(Results are truncated. Consider using a more specific path or pattern.)\n",
        );
    }

    output
}

fn render_dir(
    dir_path: &str,
    all_dirs: &BTreeSet<String>,
    files_by_dir: &BTreeMap<String, Vec<String>>,
    depth: usize,
) -> String {
    let indent = "  ".repeat(depth);
    let child_indent = "  ".repeat(depth + 1);
    let mut output = String::new();

    if depth > 0 {
        let name = dir_path.split('/').next_back().unwrap_or(dir_path);
        output.push_str(&format!("{}{}/\n", indent, name));
    }

    // Find child directories
    let children: Vec<String> = all_dirs
        .iter()
        .filter(|d| {
            let d = d.as_str();
            if d == dir_path {
                return false;
            }
            let parent = std::path::Path::new(d)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string());
            let parent = if parent.is_empty() {
                ".".to_string()
            } else {
                parent
            };
            parent == dir_path
        })
        .cloned()
        .collect();

    // Render subdirectories
    for child in &children {
        output.push_str(&render_dir(child, all_dirs, files_by_dir, depth + 1));
    }

    // Render files in this directory
    if let Some(files) = files_by_dir.get(dir_path) {
        let mut sorted_files = files.clone();
        sorted_files.sort();
        for file in &sorted_files {
            output.push_str(&format!("{}{}\n", child_indent, file));
        }
    }

    output
}
