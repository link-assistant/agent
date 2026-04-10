//! List (ls) tool implementation
//!
//! Lists directory contents with ignore patterns and tree structure output,
//! matching the JavaScript implementation's list tool behavior.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use walkdir::WalkDir;

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Default ignore patterns (mirrors JS IGNORE_PATTERNS)
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
const DESCRIPTION: &str = r#"Lists files and directories in a given path.

Usage:
- The path parameter must be an absolute path to the directory to list
- If no path is specified, lists the current working directory
- Returns a tree structure of files and directories
- Common build/cache directories are automatically excluded
- Use 'ignore' to add additional patterns to exclude"#;

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

        let dir_path = match &params.path {
            Some(p) => ctx.resolve_path(p),
            None => ctx.working_directory.clone(),
        };

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

        // Collect files using walkdir
        let mut files: Vec<String> = Vec::new();
        let mut truncated = false;

        for entry in WalkDir::new(&dir_path)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                // Allow root directory
                if e.path() == dir_path {
                    return true;
                }
                // Check if this entry should be ignored
                let name = e.file_name().to_str().unwrap_or("");
                !should_ignore(name, &ignore_patterns)
            })
        {
            if let Ok(entry) = entry {
                if entry.path() == dir_path {
                    continue;
                }
                if entry.file_type().is_file() {
                    // Get relative path from root
                    if let Ok(rel) = entry.path().strip_prefix(&dir_path) {
                        let rel_str = rel.to_string_lossy().to_string();
                        // Normalize path separators
                        let rel_str = rel_str.replace('\\', "/");
                        files.push(rel_str);
                        if files.len() >= LIMIT {
                            truncated = true;
                            break;
                        }
                    }
                }
            }
        }

        // Build tree structure similar to JS output
        let output = build_tree_output(&dir_path, &files, truncated);

        let display_title = if title.is_empty() {
            ".".to_string()
        } else {
            title
        };

        Ok(ToolResult {
            title: display_title,
            output,
            metadata: json!({
                "count": files.len(),
                "truncated": truncated,
            }),
            attachments: None,
        })
    }
}

/// Check if a file/directory name should be ignored
fn should_ignore(name: &str, patterns: &[String]) -> bool {
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

        files_by_dir
            .entry(dir)
            .or_insert_with(Vec::new)
            .push(basename);
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
        let name = dir_path.split('/').last().unwrap_or(dir_path);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_context(dir: &Path) -> ToolContext {
        ToolContext::new("ses_test", "msg_test", dir)
    }

    #[tokio::test]
    async fn test_list_directory() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("file1.txt"), "content").unwrap();
        fs::write(temp.path().join("file2.txt"), "more content").unwrap();
        fs::create_dir(temp.path().join("subdir")).unwrap();
        fs::write(temp.path().join("subdir").join("nested.txt"), "nested").unwrap();

        let tool = ListTool;
        let ctx = create_context(temp.path());
        let params = json!({});

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.contains("file1.txt"));
        assert!(result.output.contains("file2.txt"));
        assert!(result.output.contains("subdir"));
        assert!(result.output.contains("nested.txt"));
    }

    #[tokio::test]
    async fn test_list_ignores_node_modules() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("app.js"), "code").unwrap();
        fs::create_dir(temp.path().join("node_modules")).unwrap();
        fs::write(temp.path().join("node_modules").join("pkg.js"), "package").unwrap();

        let tool = ListTool;
        let ctx = create_context(temp.path());
        let params = json!({});

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.contains("app.js"));
        assert!(!result.output.contains("pkg.js"));
    }

    #[tokio::test]
    async fn test_list_nonexistent() {
        let temp = TempDir::new().unwrap();

        let tool = ListTool;
        let ctx = create_context(temp.path());
        let params = json!({ "path": "/nonexistent/path" });

        let result = tool.execute(params, &ctx).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_should_ignore() {
        let patterns = vec![
            "node_modules".to_string(),
            ".git".to_string(),
            "dist".to_string(),
        ];
        assert!(should_ignore("node_modules", &patterns));
        assert!(should_ignore(".git", &patterns));
        assert!(should_ignore("dist", &patterns));
        assert!(!should_ignore("src", &patterns));
        assert!(!should_ignore("main.rs", &patterns));
    }
}
