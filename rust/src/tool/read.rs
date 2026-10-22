//! Read tool implementation
//!
//! Reads file contents and returns them with line numbers, matching
//! the JavaScript implementation's read tool behavior.

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tokio::fs as async_fs;
use tokio::io::AsyncReadExt;

use super::{context::ToolContext, FileAttachment, Tool, ToolResult};
use crate::error::{AgentError, Result};
use crate::id::{ascending, Prefix};
use crate::util::binary::{is_binary_file, is_image_extension, validate_image_format};

use super::text_window::{format_balanced_line_window, format_column_window};

/// Default number of lines to read
const DEFAULT_READ_LIMIT: usize = 2000;

/// Maximum line length before truncation
const MAX_LINE_LENGTH: usize = 2000;

/// Maximum output size. 2000 long lines would otherwise put megabytes into
/// the context (upstream 1b82511fbd / c1b03b728a, #14009).
const MAX_BYTES: usize = 50 * 1024;

/// Bytes sampled to detect binary content, so binary files are rejected
/// without reading them whole (upstream #14009).
const BINARY_SAMPLE_BYTES: u64 = 4096;

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

        let mut filepath = ctx.resolve_path(&params.file_path);

        // Check if file exists, falling back to a name that differs only in
        // macOS narrow spaces or curly quotes (upstream #45807, #50953)
        let metadata = match fs::metadata(&filepath) {
            Ok(metadata) => metadata,
            Err(_) => match alternate_path(&filepath) {
                Some(alternate) => {
                    filepath = alternate;
                    fs::metadata(&filepath)?
                }
                None => {
                    let suggestions = find_suggestions(&filepath);
                    return Err(AgentError::file_not_found(
                        filepath.to_string_lossy(),
                        suggestions,
                    ));
                }
            },
        };
        let title = ctx.relative_path(&filepath);

        // upstream #33255/#33260: explain directories instead of an IO error
        if metadata.is_dir() {
            return Err(AgentError::tool_execution(
                "read",
                format!(
                    "Path is a directory, not a file: {}. Use the ls or glob tool to list it.",
                    filepath.display()
                ),
            ));
        }
        if !metadata.is_file() {
            return Err(AgentError::tool_execution(
                "read",
                format!("Path is not a regular file: {}", filepath.display()),
            ));
        }

        // Check if it's an image
        if let Some(image_format) = is_image_extension(&filepath) {
            return read_image(&filepath, image_format, &title, ctx).await;
        }

        // Check if binary from a sample before reading the whole file
        let mut sample = Vec::new();
        async_fs::File::open(&filepath)
            .await?
            .take(BINARY_SAMPLE_BYTES)
            .read_to_end(&mut sample)
            .await?;
        if is_binary_file(&filepath, &sample) {
            return Err(AgentError::BinaryFile {
                path: filepath.to_string_lossy().to_string(),
            });
        }

        // Read file content
        let content = async_fs::read(&filepath).await?;

        // Convert to string and split into lines
        let text = String::from_utf8_lossy(&content);
        let lines: Vec<&str> = text.lines().collect();

        let offset = params.offset.unwrap_or(0);
        // upstream 683d470fe4 (#51011): a huge `limit` cannot bypass the default
        let limit = params
            .limit
            .unwrap_or(DEFAULT_READ_LIMIT)
            .min(DEFAULT_READ_LIMIT);
        let has_explicit_line_range = params.offset.is_some() || params.limit.is_some();
        let has_explicit_column_range =
            params.column_offset.is_some() || params.column_limit.is_some();
        let column_offset = params.column_offset.unwrap_or(0);
        let column_limit = params
            .column_limit
            .unwrap_or(MAX_LINE_LENGTH)
            .min(MAX_BYTES);

        // upstream c1b03b728a (#14009)
        if has_explicit_line_range && !lines.is_empty() && offset >= lines.len() {
            return Err(AgentError::tool_execution(
                "read",
                format!(
                    "Offset {} is out of range for this file ({} lines)",
                    offset,
                    lines.len()
                ),
            ));
        }

        let selected = select_lines(&lines, offset, limit, !has_explicit_line_range);
        let format_line = |item: &SelectedLine| {
            let line = if has_explicit_column_range {
                format_column_window(item.line, item.line_number, column_offset, column_limit)
            } else {
                format_balanced_line_window(item.line, item.line_number, MAX_LINE_LENGTH)
            };
            format!("{:05}| {}", item.line_number, line)
        };

        let mut formatted: Vec<String> = Vec::new();
        let mut bytes = 0;
        let mut capped: Option<(usize, usize)> = None;
        'parts: for part in &selected.parts {
            match part {
                SelectedLinePart::Lines(items) => {
                    for item in items {
                        let line = format_line(item);
                        let size = line.len() + 1;
                        // Always show at least one line so the cap cannot return nothing
                        if bytes + size > MAX_BYTES && !formatted.is_empty() {
                            capped = Some((items[0].line_number, item.line_number - 1));
                            break 'parts;
                        }
                        formatted.push(line);
                        bytes += size;
                    }
                }
                SelectedLinePart::Omitted { start, end } => {
                    formatted.push(format!("... [omitted lines {}..{}] ...", start, end));
                }
            }
        }

        // Build output
        let mut output = String::from("<file>\n");
        output.push_str(&formatted.join("\n"));

        let total_lines = lines.len();
        let last_read_line = selected.last_line;
        let has_more = has_explicit_line_range && total_lines > last_read_line;

        if let Some((first, last)) = capped {
            // `offset` is 0-based, so the next unread line starts at `last`
            output.push_str(&format!(
                "\n\n(Output capped at 50 KB. Showing lines {}-{}. Use offset={} to continue.)",
                first, last, last
            ));
        } else if has_more {
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

/// Map look-alike characters in file names to the ones users type: macOS
/// screenshots use U+202F before AM/PM and editors produce curly quotes
/// (upstream d484f070d1 #45807, b47824fb63 #50953)
fn canonical_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '\u{00a0}' | '\u{202f}' => ' ',
            '\u{2018}' | '\u{2019}' => '\'',
            c => c,
        })
        .collect()
}

/// Find the one file in the parent directory whose canonical name matches
fn alternate_path(path: &Path) -> Option<PathBuf> {
    let dir = path.parent()?;
    let wanted = canonical_name(&path.file_name()?.to_string_lossy());
    let mut matches = fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| canonical_name(&e.file_name().to_string_lossy()) == wanted)
        .map(|e| e.path());
    let first = matches.next()?;
    // Ambiguous matches are not guessed
    if matches.next().is_some() {
        return None;
    }
    Some(first)
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
