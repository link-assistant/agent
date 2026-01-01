//! Read tool implementation
//!
//! Reads file contents and returns them with line numbers, matching
//! the JavaScript implementation's read tool behavior.

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use tokio::fs as async_fs;

use super::{context::ToolContext, FileAttachment, Tool, ToolResult};
use crate::error::{AgentError, Result};
use crate::id::{ascending, Prefix};
use crate::util::binary::{is_binary_file, is_image_extension, validate_image_format};

/// Default number of lines to read
const DEFAULT_READ_LIMIT: usize = 2000;

/// Maximum line length before truncation
const MAX_LINE_LENGTH: usize = 2000;

/// Tool description
const DESCRIPTION: &str = r#"Reads a file from the local filesystem.

Usage:
- The filePath parameter must be an absolute path
- By default, reads up to 2000 lines from the beginning
- Optionally specify offset and limit for pagination
- Returns content with line numbers
- Can read image files (returns base64 encoded data)
- Detects and rejects binary files"#;

/// Parameters for the read tool
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadParams {
    /// The path to the file to read
    pub file_path: String,
    /// Line number to start reading from (0-based)
    #[serde(default)]
    pub offset: Option<usize>,
    /// Number of lines to read
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Read tool implementation
pub struct ReadTool;

#[async_trait]
impl Tool for ReadTool {
    fn id(&self) -> &'static str {
        "read"
    }

    fn description(&self) -> &'static str {
        DESCRIPTION
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "filePath": {
                    "type": "string",
                    "description": "The path to the file to read"
                },
                "offset": {
                    "type": "number",
                    "description": "The line number to start reading from (0-based)"
                },
                "limit": {
                    "type": "number",
                    "description": "The number of lines to read (defaults to 2000)"
                }
            },
            "required": ["filePath"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: ReadParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("read", e.to_string()))?;

        let filepath = ctx.resolve_path(&params.file_path);
        let title = ctx.relative_path(&filepath);

        // Check if file exists
        if !filepath.exists() {
            let suggestions = find_suggestions(&filepath);
            return Err(AgentError::file_not_found(
                filepath.to_string_lossy(),
                suggestions,
            ));
        }

        // Check if it's an image
        if let Some(image_format) = is_image_extension(&filepath) {
            return read_image(&filepath, image_format, &title, ctx).await;
        }

        // Read file content
        let content = async_fs::read(&filepath).await?;

        // Check if binary
        if is_binary_file(&filepath, &content) {
            return Err(AgentError::BinaryFile {
                path: filepath.to_string_lossy().to_string(),
            });
        }

        // Convert to string and split into lines
        let text = String::from_utf8_lossy(&content);
        let lines: Vec<&str> = text.lines().collect();

        let offset = params.offset.unwrap_or(0);
        let limit = params.limit.unwrap_or(DEFAULT_READ_LIMIT);

        // Get the requested range of lines
        let end = (offset + limit).min(lines.len());
        let selected_lines = &lines[offset.min(lines.len())..end];

        // Format lines with line numbers and truncation
        let formatted: Vec<String> = selected_lines
            .iter()
            .enumerate()
            .map(|(i, line)| {
                let line_num = i + offset + 1;
                let truncated = if line.len() > MAX_LINE_LENGTH {
                    format!("{}...", &line[..MAX_LINE_LENGTH])
                } else {
                    line.to_string()
                };
                format!("{:05}| {}", line_num, truncated)
            })
            .collect();

        // Build output
        let mut output = String::from("<file>\n");
        output.push_str(&formatted.join("\n"));

        let total_lines = lines.len();
        let last_read_line = offset + formatted.len();
        let has_more = total_lines > last_read_line;

        if has_more {
            output.push_str(&format!(
                "\n\n(File has more lines. Use 'offset' parameter to read beyond line {})",
                last_read_line
            ));
        } else {
            output.push_str(&format!("\n\n(End of file - total {} lines)", total_lines));
        }
        output.push_str("\n</file>");

        // Create preview from first 20 lines
        let preview: String = selected_lines
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");

        Ok(ToolResult {
            title,
            output,
            metadata: json!({
                "preview": preview,
            }),
            attachments: None,
        })
    }
}

/// Find file suggestions when a file is not found
fn find_suggestions(path: &Path) -> Vec<String> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let base = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if !dir.exists() {
        return vec![];
    }

    fs::read_dir(dir)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|name| {
                    let lower = name.to_lowercase();
                    lower.contains(&base) || base.contains(&lower)
                })
                .take(3)
                .map(|name| dir.join(name).to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Read an image file and return base64 encoded data
async fn read_image(
    path: &Path,
    format: &str,
    title: &str,
    ctx: &ToolContext,
) -> Result<ToolResult> {
    let content = async_fs::read(path).await?;

    // Validate image format
    if !validate_image_format(&content, format) {
        return Err(AgentError::ToolExecution {
            tool: "read".to_string(),
            message: format!(
                "Image validation failed: {} has image extension but does not contain valid {} data",
                path.display(),
                format
            ),
        });
    }

    // Determine MIME type
    let mime = match format {
        "JPEG" => "image/jpeg",
        "PNG" => "image/png",
        "GIF" => "image/gif",
        "BMP" => "image/bmp",
        "WebP" => "image/webp",
        "TIFF" => "image/tiff",
        "SVG" => "image/svg+xml",
        "ICO" => "image/x-icon",
        "AVIF" => "image/avif",
        _ => "application/octet-stream",
    };

    // Create base64 data URL
    let base64_data = BASE64.encode(&content);
    let data_url = format!("data:{};base64,{}", mime, base64_data);

    let attachment = FileAttachment {
        id: ascending(Prefix::Part, None),
        session_id: ctx.session_id.clone(),
        message_id: ctx.message_id.clone(),
        attachment_type: "file".to_string(),
        mime: mime.to_string(),
        url: data_url,
    };

    Ok(ToolResult {
        title: title.to_string(),
        output: "Image read successfully".to_string(),
        metadata: json!({
            "preview": "Image read successfully",
        }),
        attachments: Some(vec![attachment]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_context(dir: &Path) -> ToolContext {
        ToolContext::new("ses_test", "msg_test", dir)
    }

    #[tokio::test]
    async fn test_read_text_file() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");
        fs::write(&file_path, "line 1\nline 2\nline 3\n").unwrap();

        let tool = ReadTool;
        let ctx = create_context(temp.path());
        let params = json!({ "filePath": file_path.to_string_lossy() });

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.contains("line 1"));
        assert!(result.output.contains("line 2"));
        assert!(result.output.contains("line 3"));
        assert!(result.output.contains("00001|"));
    }

    #[tokio::test]
    async fn test_read_with_offset_and_limit() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");
        let content: String = (1..=100).map(|i| format!("line {}\n", i)).collect();
        fs::write(&file_path, content).unwrap();

        let tool = ReadTool;
        let ctx = create_context(temp.path());
        let params = json!({
            "filePath": file_path.to_string_lossy(),
            "offset": 10,
            "limit": 5
        });

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.contains("line 11"));
        assert!(result.output.contains("line 15"));
        assert!(!result.output.contains("line 16"));
    }

    #[tokio::test]
    async fn test_read_nonexistent_file() {
        let temp = TempDir::new().unwrap();
        let tool = ReadTool;
        let ctx = create_context(temp.path());
        let params = json!({ "filePath": "/nonexistent/file.txt" });

        let result = tool.execute(params, &ctx).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_read_binary_file() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.bin");
        fs::write(&file_path, &[0, 1, 2, 3, 0, 0, 0]).unwrap();

        let tool = ReadTool;
        let ctx = create_context(temp.path());
        let params = json!({ "filePath": file_path.to_string_lossy() });

        let result = tool.execute(params, &ctx).await;
        assert!(result.is_err());
    }
}
