//! Write tool implementation
//!
//! Writes content to files, matching the JavaScript implementation's write tool behavior.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::fs;

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Tool description
const DESCRIPTION: &str = r#"Writes content to a file on the local filesystem.

Usage:
- The filePath parameter must be an absolute path
- Will create parent directories if they don't exist
- Will overwrite existing files
- Returns the path to the written file"#;

/// Parameters for the write tool
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteParams {
    /// The content to write to the file
    pub content: String,
    /// The absolute path to the file to write
    pub file_path: String,
}

/// Write tool implementation
pub struct WriteTool;

#[async_trait]
impl Tool for WriteTool {
    fn id(&self) -> &'static str {
        "write"
    }

    fn description(&self) -> &'static str {
        DESCRIPTION
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The content to write to the file"
                },
                "filePath": {
                    "type": "string",
                    "description": "The absolute path to the file to write (must be absolute, not relative)"
                }
            },
            "required": ["content", "filePath"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: WriteParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("write", e.to_string()))?;

        let filepath = ctx.resolve_path(&params.file_path);
        let title = ctx.relative_path(&filepath);

        // Check if file exists before writing
        let exists = filepath.exists();

        // Create parent directories if needed
        if let Some(parent) = filepath.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).await?;
            }
        }

        // Keep an existing UTF-8 BOM and never write it twice
        // (upstream OpenCode #23797).
        let content = params.content.strip_prefix('\u{feff}');
        let had_bom = exists && starts_with_bom(&filepath).await;
        let content = match content {
            Some(text) => format!("\u{feff}{}", text),
            None if had_bom => format!("\u{feff}{}", params.content),
            None => params.content.clone(),
        };

        // Write the file
        fs::write(&filepath, &content).await?;

        Ok(ToolResult {
            is_error: false,
            title,
            output: "Wrote file successfully.".to_string(),
            metadata: json!({
                "diagnostics": {},
                "filepath": filepath.to_string_lossy(),
                "exists": exists,
            }),
            attachments: None,
        })
    }
}

/// Reads only the first three bytes to detect a UTF-8 BOM.
async fn starts_with_bom(path: &std::path::Path) -> bool {
    use tokio::io::AsyncReadExt;
    let mut head = [0u8; 3];
    match fs::File::open(path).await {
        Ok(mut file) => file.read_exact(&mut head).await.is_ok() && head == [0xef, 0xbb, 0xbf],
        Err(_) => false,
    }
}
