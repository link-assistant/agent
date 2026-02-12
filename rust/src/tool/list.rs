//! List (ls) tool implementation
//!
//! Lists directory contents, matching the JavaScript implementation's list tool behavior.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Tool description
const DESCRIPTION: &str = r#"Lists files and directories in a given path.

Usage:
- If no path is specified, lists the current working directory
- Returns file names, sizes, and modification times
- Directories are marked with a trailing slash"#;

/// Parameters for the list tool
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    /// The path to list (defaults to current directory)
    #[serde(default)]
    pub path: Option<String>,
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
                    "description": "The path to list (defaults to current directory)"
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

        let entries = list_directory(&dir_path)?;

        Ok(ToolResult {
            title: if title.is_empty() {
                ".".to_string()
            } else {
                title
            },
            output: entries.join("\n"),
            metadata: json!({
                "count": entries.len(),
            }),
            attachments: None,
        })
    }
}

/// List directory contents
fn list_directory(path: &Path) -> Result<Vec<String>> {
    let mut entries = Vec::new();

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        let name = entry.file_name().to_string_lossy().to_string();

        let formatted = if metadata.is_dir() {
            format!("{}/", name)
        } else {
            let size = metadata.len();
            format!("{} ({})", name, format_size(size))
        };

        entries.push(formatted);
    }

    entries.sort();
    Ok(entries)
}

/// Format file size in human-readable form
fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.1}GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1}MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1}KB", bytes as f64 / KB as f64)
    } else {
        format!("{}B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

        let tool = ListTool;
        let ctx = create_context(temp.path());
        let params = json!({});

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.contains("file1.txt"));
        assert!(result.output.contains("file2.txt"));
        assert!(result.output.contains("subdir/"));
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
    fn test_format_size() {
        assert_eq!(format_size(0), "0B");
        assert_eq!(format_size(512), "512B");
        assert_eq!(format_size(1024), "1.0KB");
        assert_eq!(format_size(1536), "1.5KB");
        assert_eq!(format_size(1048576), "1.0MB");
        assert_eq!(format_size(1073741824), "1.0GB");
    }
}
