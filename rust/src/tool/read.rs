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

use super::text_window::{format_balanced_line_window, format_column_window};

/// Default number of lines to read
const DEFAULT_READ_LIMIT: usize = 2000;

/// Maximum line length before truncation
const MAX_LINE_LENGTH: usize = 2000;

/// Tool description
const DESCRIPTION: &str = r#"Reads a file from the local filesystem.

Usage:
- The filePath parameter must be an absolute path
- By default, reads the whole file when it fits the limit; longer files return first and last line ranges with an omitted-lines marker
- Optionally specify offset and limit for line pagination
- Optionally specify columnOffset and columnLimit to read a column window from each selected line
- Long lines are summarized with omitted-column ranges instead of being silently truncated
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
    /// Column number to start reading from (0-based)
    #[serde(default)]
    pub column_offset: Option<usize>,
    /// Number of columns to read from each selected line
    #[serde(default)]
    pub column_limit: Option<usize>,
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
                },
                "columnOffset": {
                    "type": "number",
                    "description": "The column number to start reading from (0-based)"
                },
                "columnLimit": {
                    "type": "number",
                    "description": "The number of columns to read from each selected line"
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
        let has_explicit_line_range = params.offset.is_some() || params.limit.is_some();
        let has_explicit_column_range =
            params.column_offset.is_some() || params.column_limit.is_some();
        let column_offset = params.column_offset.unwrap_or(0);
        let column_limit = params.column_limit.unwrap_or(MAX_LINE_LENGTH);

        let selected = select_lines(&lines, offset, limit, !has_explicit_line_range);
        let formatted: Vec<String> = selected
            .parts
            .iter()
            .flat_map(|part| match part {
                SelectedLinePart::Lines(items) => items
                    .iter()
                    .map(|item| {
                        let line = if has_explicit_column_range {
                            format_column_window(
                                item.line,
                                item.line_number,
                                column_offset,
                                column_limit,
                            )
                        } else {
                            format_balanced_line_window(
                                item.line,
                                item.line_number,
                                MAX_LINE_LENGTH,
                            )
                        };
                        format!("{:05}| {}", item.line_number, line)
                    })
                    .collect::<Vec<_>>(),
                SelectedLinePart::Omitted { start, end } => {
                    vec![format!("... [omitted lines {}..{}] ...", start, end)]
                }
            })
            .collect();

        // Build output
        let mut output = String::from("<file>\n");
        output.push_str(&formatted.join("\n"));

        let total_lines = lines.len();
        let last_read_line = selected.last_line;
        let has_more = has_explicit_line_range && total_lines > last_read_line;

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
        let preview: String = formatted
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");

        Ok(ToolResult {
            is_error: false,
            title,
            output,
            metadata: json!({
                "preview": preview,
            }),
            attachments: None,
        })
    }
}

struct SelectedLine<'a> {
    line: &'a str,
    line_number: usize,
}

enum SelectedLinePart<'a> {
    Lines(Vec<SelectedLine<'a>>),
    Omitted { start: usize, end: usize },
}

struct SelectedLines<'a> {
    parts: Vec<SelectedLinePart<'a>>,
    last_line: usize,
}

fn select_lines<'a>(
    lines: &'a [&'a str],
    offset: usize,
    limit: usize,
    summarize_middle: bool,
) -> SelectedLines<'a> {
    let total_lines = lines.len();

    if !summarize_middle || total_lines <= limit {
        let end = offset.saturating_add(limit).min(total_lines);
        return SelectedLines {
            parts: vec![SelectedLinePart::Lines(line_range(lines, offset, end))],
            last_line: end,
        };
    }

    let head_count = limit.div_ceil(2);
    let tail_count = limit - head_count;
    let tail_start = total_lines - tail_count;

    SelectedLines {
        parts: vec![
            SelectedLinePart::Lines(line_range(lines, 0, head_count)),
            SelectedLinePart::Omitted {
                start: head_count + 1,
                end: tail_start,
            },
            SelectedLinePart::Lines(line_range(lines, tail_start, total_lines)),
        ],
        last_line: total_lines,
    }
}

fn line_range<'a>(lines: &'a [&'a str], start: usize, end: usize) -> Vec<SelectedLine<'a>> {
    lines[start.min(lines.len())..end.min(lines.len())]
        .iter()
        .enumerate()
        .map(|(index, line)| SelectedLine {
            line,
            line_number: start + index + 1,
        })
        .collect()
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
        is_error: false,
        title: title.to_string(),
        output: "Image read successfully".to_string(),
        metadata: json!({
            "preview": "Image read successfully",
        }),
        attachments: Some(vec![attachment]),
    })
}
