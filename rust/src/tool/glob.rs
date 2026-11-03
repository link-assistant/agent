//! Glob tool implementation
//!
//! File pattern matching tool, matching the JavaScript implementation's glob
//! tool, which lists files with `rg --files --hidden --glob=<pattern>`:
//!
//! - the pattern has rg `--glob` semantics: without a `/` it matches the file
//!   name at any depth (`*.ts` finds `src/a.ts`), with one it matches the
//!   path relative to the search directory;
//! - `.gitignore`/`.ignore` rules apply, dotfiles are listed, `.git` is
//!   skipped and symlinks are not followed
//!   (`LINK_ASSISTANT_AGENT_GLOB_FOLLOW_SYMLINKS` follows them);
//! - the first 100 files found are listed newest first as absolute paths,
//!   "No files found" when there are none;
//! - a missing path or a path that is not a directory is an error.
//!
//! `LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT=true` restores the earlier
//! listing: shell-style matching with the `glob` crate (`*.ts` only in the
//! search directory), paths relative to the working directory, an empty
//! output when nothing matches and the pattern as title.

use async_trait::async_trait;
use glob::glob as glob_match;
use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Maximum number of results, matching the JavaScript glob tool
const LIMIT: usize = 100;

const NO_FILES_FOUND: &str = "No files found";
const TRUNCATED_NOTE: &str =
    "(Results are truncated. Consider using a more specific path or pattern.)";

/// Tool description
const DESCRIPTION: &str = r#"- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful."#;

/// Parameters for the glob tool
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobParams {
    /// The glob pattern to match files against
    pub pattern: String,
    /// The directory to search in (defaults to working directory)
    #[serde(default)]
    pub path: Option<String>,
}

/// Glob tool implementation
pub struct GlobTool;

#[async_trait]
impl Tool for GlobTool {
    fn id(&self) -> &'static str {
        "glob"
    }

    fn description(&self) -> &'static str {
        DESCRIPTION
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "The glob pattern to match files against"
                },
                "path": {
                    "type": "string",
                    "description": "The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - simply omit it for the default behavior. Must be a valid directory path if provided."
                }
            },
            "required": ["pattern"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: GlobParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("glob", e.to_string()))?;
        let settings = ctx.settings();

        let base_path = match &params.path {
            Some(p) if !p.is_empty() => ctx.resolve_path(p),
            _ => ctx.working_directory.clone(),
        };

        if settings.legacy_tool_output {
            return legacy_glob(&params, &base_path, ctx);
        }

        match fs::metadata(&base_path) {
            Err(_) => {
                return Err(AgentError::tool_execution(
                    "glob",
                    format!("No such file or directory: '{}'", base_path.display()),
                ))
            }
            // upstream f753103e82 (#38890)
            Ok(info) if !info.is_dir() => {
                return Err(AgentError::tool_execution(
                    "glob",
                    format!("Search path is not a directory: {}", base_path.display()),
                ))
            }
            Ok(_) => {}
        }

        let cancelled = Arc::new(AtomicBool::new(false));
        let _cancel_on_drop = CancelOnDrop(cancelled.clone());
        let search = Search {
            base: base_path.clone(),
            pattern: params.pattern.clone(),
            follow_links: settings.glob_follow_symlinks,
            cancelled,
        };
        let (files, truncated) = tokio::task::spawn_blocking(move || search.run())
            .await
            .map_err(|e| AgentError::tool_execution("glob", e.to_string()))?
            .map_err(|e| AgentError::tool_execution("glob", e))?;

        let mut output: Vec<String> = files.iter().map(|f| f.display().to_string()).collect();
        if output.is_empty() {
            output.push(NO_FILES_FOUND.to_string());
        } else if truncated {
            output.push(String::new());
            output.push(TRUNCATED_NOTE.to_string());
        }

        Ok(ToolResult {
            is_error: false,
            title: ctx.relative_path(&base_path),
            output: output.join("\n"),
            metadata: json!({
                "count": files.len(),
                "truncated": truncated,
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

struct Search {
    base: PathBuf,
    pattern: String,
    follow_links: bool,
    cancelled: Arc<AtomicBool>,
}

impl Search {
    /// The first [`LIMIT`] files found, newest first, and whether there
    /// were more.
    fn run(self) -> std::result::Result<(Vec<PathBuf>, bool), String> {
        let mut found: Vec<PathBuf> = Vec::new();
        let mut truncated = false;
        self.walk(|path| {
            if found.len() >= LIMIT {
                truncated = true;
                return false;
            }
            found.push(path.to_path_buf());
            true
        })?;
        Ok((newest_first(found), truncated))
    }

    /// Visit matching files in file-name order until `visit` returns false.
    fn walk(&self, mut visit: impl FnMut(&Path) -> bool) -> std::result::Result<(), String> {
        let invalid = |e: ignore::Error| format!("Invalid pattern: {}", e);
        let pattern = self.pattern.as_str();
        // An absolute pattern (accepted by earlier releases) is anchored to
        // the search directory when it is inside it.
        let pattern = if Path::new(pattern).is_absolute() {
            match Path::new(pattern).strip_prefix(&self.base) {
                Ok(rest) => format!("/{}", rest.to_string_lossy()),
                Err(_) => return absolute_glob(pattern, &self.cancelled, visit),
            }
        } else {
            pattern.to_string()
        };
        let mut overrides = OverrideBuilder::new(&self.base);
        overrides.add(&pattern).map_err(invalid)?;
        let overrides = overrides.build().map_err(invalid)?;

        let walker = WalkBuilder::new(&self.base)
            .hidden(false)
            .follow_links(self.follow_links)
            .overrides(overrides)
            .sort_by_file_name(|a, b| a.cmp(b))
            .filter_entry(|entry| entry.depth() == 0 || entry.file_name() != ".git")
            .build();
        for entry in walker {
            if self.cancelled.load(Ordering::Relaxed) {
                return Err("Glob was cancelled".to_string());
            }
            // Unreadable entries are skipped, as rg does
            let Ok(entry) = entry else { continue };
            if entry.depth() == 0 || !entry.file_type().is_some_and(|t| t.is_file()) {
                continue;
            }
            if !visit(entry.path()) {
                break;
            }
        }
        Ok(())
    }
}

/// An absolute pattern outside the search directory: matched with the
/// `glob` crate as earlier releases did.
fn absolute_glob(
    pattern: &str,
    cancelled: &AtomicBool,
    mut visit: impl FnMut(&Path) -> bool,
) -> std::result::Result<(), String> {
    let paths = glob_match(pattern).map_err(|e| format!("Invalid pattern: {}", e))?;
    for path in paths.flatten() {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Glob was cancelled".to_string());
        }
        if path.is_file() && !visit(&path) {
            break;
        }
    }
    Ok(())
}

fn mtime_millis(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Newest first; a file whose time cannot be read counts as oldest. Ties
/// keep the walk order.
fn newest_first(files: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut stamped: Vec<(u128, PathBuf)> =
        files.into_iter().map(|f| (mtime_millis(&f), f)).collect();
    stamped.sort_by_key(|(mtime, _)| std::cmp::Reverse(*mtime));
    stamped.into_iter().map(|(_, f)| f).collect()
}

/// The earlier listing (legacy tool output).
fn legacy_glob(params: &GlobParams, base_path: &Path, ctx: &ToolContext) -> Result<ToolResult> {
    let full_pattern = if params.pattern.starts_with('/') {
        params.pattern.clone()
    } else {
        base_path
            .join(&params.pattern)
            .to_string_lossy()
            .to_string()
    };

    let mut matches: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
    for entry in glob_match(&full_pattern)
        .map_err(|e| AgentError::tool_execution("glob", format!("Invalid pattern: {}", e)))?
    {
        match entry {
            Ok(path) => {
                if path.is_file() {
                    let mtime = path
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(UNIX_EPOCH);
                    matches.push((path, mtime));
                }
            }
            Err(e) => tracing::debug!("Glob error: {}", e),
        }
    }

    matches.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    let truncated = matches.len() > LIMIT;
    matches.truncate(LIMIT);

    let output: Vec<String> = matches
        .iter()
        .map(|(path, _)| ctx.relative_path(path))
        .collect();
    let count = output.len();
    let mut output = output.join("\n");
    if truncated {
        output.push_str("\n\n");
        output.push_str(TRUNCATED_NOTE);
    }

    Ok(ToolResult {
        is_error: false,
        title: params.pattern.clone(),
        output,
        metadata: json!({
            "count": count,
            "truncated": truncated,
        }),
        attachments: None,
    })
}
