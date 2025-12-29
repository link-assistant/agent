//! Glob tool implementation
//!
//! File pattern matching tool, matching the JavaScript implementation's glob tool behavior.

use async_trait::async_trait;
use glob::glob as glob_match;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Tool description
const DESCRIPTION: &str = r#"Fast file pattern matching tool.

Usage:
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use for finding files by name patterns"#;

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
                    "description": "The directory to search in (defaults to working directory)"
                }
            },
            "required": ["pattern"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: GlobParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("glob", e.to_string()))?;

        let base_path = match &params.path {
            Some(p) => ctx.resolve_path(p),
            None => ctx.working_directory.clone(),
        };

        // Construct full pattern
        let full_pattern = if params.pattern.starts_with('/') {
            params.pattern.clone()
        } else {
            base_path.join(&params.pattern).to_string_lossy().to_string()
        };

        let title = params.pattern.clone();

        // Execute glob and collect results
        let mut matches: Vec<(std::path::PathBuf, std::time::SystemTime)> = Vec::new();

        for entry in glob_match(&full_pattern).map_err(|e| {
            AgentError::tool_execution("glob", format!("Invalid pattern: {}", e))
        })? {
            match entry {
                Ok(path) => {
                    if path.is_file() {
                        let mtime = path
                            .metadata()
                            .and_then(|m| m.modified())
                            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                        matches.push((path, mtime));
                    }
                }
                Err(e) => {
                    // Skip unreadable entries
                    tracing::debug!("Glob error: {}", e);
                }
            }
        }

        // Sort by modification time (most recent first)
        matches.sort_by(|a, b| b.1.cmp(&a.1));

        // Format output
        let output: Vec<String> = matches
            .iter()
            .map(|(path, _)| ctx.relative_path(path))
            .collect();

        Ok(ToolResult {
            title,
            output: output.join("\n"),
            metadata: json!({
                "count": output.len(),
            }),
            attachments: None,
        })
    }
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
    async fn test_glob_txt_files() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("file1.txt"), "content").unwrap();
        fs::write(temp.path().join("file2.txt"), "content").unwrap();
        fs::write(temp.path().join("file3.rs"), "content").unwrap();

        let tool = GlobTool;
        let ctx = create_context(temp.path());
        let params = json!({ "pattern": "*.txt" });

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.contains("file1.txt"));
        assert!(result.output.contains("file2.txt"));
        assert!(!result.output.contains("file3.rs"));
    }

    #[tokio::test]
    async fn test_glob_recursive() {
        let temp = TempDir::new().unwrap();
        fs::create_dir(temp.path().join("subdir")).unwrap();
        fs::write(temp.path().join("root.txt"), "content").unwrap();
        fs::write(temp.path().join("subdir").join("nested.txt"), "content").unwrap();

        let tool = GlobTool;
        let ctx = create_context(temp.path());
        let params = json!({ "pattern": "**/*.txt" });

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.contains("root.txt"));
        assert!(result.output.contains("nested.txt"));
    }

    #[tokio::test]
    async fn test_glob_no_matches() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("file.txt"), "content").unwrap();

        let tool = GlobTool;
        let ctx = create_context(temp.path());
        let params = json!({ "pattern": "*.rs" });

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.is_empty());
        assert_eq!(result.metadata["count"], 0);
    }
}
