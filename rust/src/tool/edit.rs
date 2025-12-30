//! Edit tool implementation
//!
//! Performs string replacement in files with various fallback strategies,
//! matching the JavaScript implementation's edit tool behavior.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use similar::{ChangeTag, TextDiff};
use tokio::fs;

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Tool description
const DESCRIPTION: &str = r#"Performs exact string replacements in files.

Usage:
- The filePath parameter must be an absolute path
- oldString must exist in the file (exact match or fuzzy match fallback)
- newString must be different from oldString
- Use replaceAll=true to replace all occurrences
- The edit will fail if oldString matches multiple locations (use more context)"#;

/// Parameters for the edit tool
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditParams {
    /// The absolute path to the file to modify
    pub file_path: String,
    /// The text to replace
    pub old_string: String,
    /// The text to replace it with
    pub new_string: String,
    /// Replace all occurrences (default false)
    #[serde(default)]
    pub replace_all: bool,
}

/// Edit tool implementation
pub struct EditTool;

#[async_trait]
impl Tool for EditTool {
    fn id(&self) -> &'static str {
        "edit"
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
                    "description": "The absolute path to the file to modify"
                },
                "oldString": {
                    "type": "string",
                    "description": "The text to replace"
                },
                "newString": {
                    "type": "string",
                    "description": "The text to replace it with (must be different from oldString)"
                },
                "replaceAll": {
                    "type": "boolean",
                    "description": "Replace all occurrences of oldString (default false)"
                }
            },
            "required": ["filePath", "oldString", "newString"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: EditParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("edit", e.to_string()))?;

        if params.old_string == params.new_string {
            return Err(AgentError::invalid_arguments(
                "edit",
                "oldString and newString must be different",
            ));
        }

        let filepath = ctx.resolve_path(&params.file_path);
        let title = ctx.relative_path(&filepath);

        // Handle new file creation (oldString is empty)
        if params.old_string.is_empty() {
            fs::write(&filepath, &params.new_string).await?;

            let diff = create_diff("", &params.new_string, &filepath.to_string_lossy());

            return Ok(ToolResult {
                title,
                output: String::new(),
                metadata: json!({
                    "diagnostics": {},
                    "diff": diff,
                    "filediff": {
                        "file": filepath.to_string_lossy(),
                        "before": "",
                        "after": params.new_string,
                        "additions": params.new_string.lines().count(),
                        "deletions": 0,
                    }
                }),
                attachments: None,
            });
        }

        // Read existing file
        if !filepath.exists() {
            return Err(AgentError::file_not_found(
                filepath.to_string_lossy(),
                vec![],
            ));
        }

        let content_old = fs::read_to_string(&filepath).await?;
        let content_old = normalize_line_endings(&content_old);

        // Perform replacement
        let content_new = replace(
            &content_old,
            &params.old_string,
            &params.new_string,
            params.replace_all,
        )?;

        // Write the file
        fs::write(&filepath, &content_new).await?;

        // Calculate diff
        let diff = create_diff(&content_old, &content_new, &filepath.to_string_lossy());

        // Count additions and deletions
        let text_diff = TextDiff::from_lines(&content_old, &content_new);
        let mut additions = 0;
        let mut deletions = 0;
        for change in text_diff.iter_all_changes() {
            match change.tag() {
                ChangeTag::Insert => additions += 1,
                ChangeTag::Delete => deletions += 1,
                ChangeTag::Equal => {}
            }
        }

        Ok(ToolResult {
            title,
            output: String::new(),
            metadata: json!({
                "diagnostics": {},
                "diff": diff,
                "filediff": {
                    "file": filepath.to_string_lossy(),
                    "before": content_old,
                    "after": content_new,
                    "additions": additions,
                    "deletions": deletions,
                }
            }),
            attachments: None,
        })
    }
}

/// Normalize line endings to Unix style
fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// Create a unified diff string
fn create_diff(old: &str, new: &str, path: &str) -> String {
    let diff = TextDiff::from_lines(old, new);

    let mut result = format!("--- {}\n+++ {}\n", path, path);

    for (idx, group) in diff.grouped_ops(3).iter().enumerate() {
        if idx > 0 {
            result.push_str("...\n");
        }

        for op in group {
            for change in diff.iter_changes(op) {
                let sign = match change.tag() {
                    ChangeTag::Delete => "-",
                    ChangeTag::Insert => "+",
                    ChangeTag::Equal => " ",
                };
                result.push_str(sign);
                result.push_str(change.value());
                if change.missing_newline() {
                    result.push('\n');
                }
            }
        }
    }

    result
}

/// Perform string replacement with fallback strategies
fn replace(content: &str, old_string: &str, new_string: &str, replace_all: bool) -> Result<String> {
    // Try exact match first
    if let Some(result) = try_exact_replace(content, old_string, new_string, replace_all) {
        return Ok(result);
    }

    // Try line-trimmed matching
    if let Some(result) = try_line_trimmed_replace(content, old_string, new_string, replace_all) {
        return Ok(result);
    }

    // Try whitespace-normalized matching
    if let Some(result) =
        try_whitespace_normalized_replace(content, old_string, new_string, replace_all)
    {
        return Ok(result);
    }

    // Try block anchor matching
    if let Some(result) = try_block_anchor_replace(content, old_string, new_string, replace_all) {
        return Ok(result);
    }

    Err(AgentError::tool_execution(
        "edit",
        "oldString not found in content",
    ))
}

/// Try exact string replacement
fn try_exact_replace(content: &str, old: &str, new: &str, replace_all: bool) -> Option<String> {
    if !content.contains(old) {
        return None;
    }

    if replace_all {
        return Some(content.replace(old, new));
    }

    // Check for unique match
    let first_idx = content.find(old)?;
    let last_idx = content.rfind(old)?;

    if first_idx != last_idx {
        // Multiple matches, need more context
        return None;
    }

    Some(format!(
        "{}{}{}",
        &content[..first_idx],
        new,
        &content[first_idx + old.len()..]
    ))
}

/// Try line-trimmed matching (ignore leading/trailing whitespace per line)
fn try_line_trimmed_replace(
    content: &str,
    old: &str,
    new: &str,
    replace_all: bool,
) -> Option<String> {
    let content_lines: Vec<&str> = content.lines().collect();
    let search_lines: Vec<&str> = old.lines().collect();

    if search_lines.is_empty() {
        return None;
    }

    let mut matches = Vec::new();

    for i in 0..=content_lines.len().saturating_sub(search_lines.len()) {
        let mut all_match = true;

        for j in 0..search_lines.len() {
            if content_lines.get(i + j).map(|l| l.trim()) != Some(search_lines[j].trim()) {
                all_match = false;
                break;
            }
        }

        if all_match {
            // Calculate the actual matched text
            let matched: String = content_lines[i..i + search_lines.len()].join("\n");
            matches.push((i, matched));
        }
    }

    if matches.is_empty() {
        return None;
    }

    if !replace_all && matches.len() > 1 {
        return None;
    }

    // Perform replacement
    let mut result = content.to_string();
    for (_, matched) in matches.into_iter().rev() {
        result = result.replacen(&matched, new, 1);
        if !replace_all {
            break;
        }
    }

    Some(result)
}

/// Try whitespace-normalized matching
fn try_whitespace_normalized_replace(
    content: &str,
    old: &str,
    new: &str,
    replace_all: bool,
) -> Option<String> {
    fn normalize_whitespace(s: &str) -> String {
        s.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    let normalized_old = normalize_whitespace(old);

    // Check each line
    let mut matches = Vec::new();
    for line in content.lines() {
        let normalized_line = normalize_whitespace(line);
        if normalized_line == normalized_old {
            matches.push(line.to_string());
        }
    }

    if matches.is_empty() {
        return None;
    }

    if !replace_all && matches.len() > 1 {
        return None;
    }

    // Replace the first (or all) matches
    let mut result = content.to_string();
    for matched in matches.into_iter() {
        result = result.replacen(&matched, new, 1);
        if !replace_all {
            break;
        }
    }

    Some(result)
}

/// Try block anchor matching (match by first and last line)
fn try_block_anchor_replace(
    content: &str,
    old: &str,
    new: &str,
    replace_all: bool,
) -> Option<String> {
    let content_lines: Vec<&str> = content.lines().collect();
    let search_lines: Vec<&str> = old.lines().collect();

    if search_lines.len() < 3 {
        return None;
    }

    let first_line = search_lines[0].trim();
    let last_line = search_lines.last()?.trim();

    let mut matches = Vec::new();

    for i in 0..content_lines.len() {
        if content_lines[i].trim() != first_line {
            continue;
        }

        for j in (i + 2)..content_lines.len() {
            if content_lines[j].trim() == last_line {
                let matched: String = content_lines[i..=j].join("\n");
                matches.push(matched);
                break;
            }
        }
    }

    if matches.is_empty() {
        return None;
    }

    if !replace_all && matches.len() > 1 {
        return None;
    }

    let mut result = content.to_string();
    for matched in matches.into_iter() {
        result = result.replacen(&matched, new, 1);
        if !replace_all {
            break;
        }
    }

    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs as std_fs;
    use tempfile::TempDir;

    fn create_context(dir: &std::path::Path) -> ToolContext {
        ToolContext::new("ses_test", "msg_test", dir)
    }

    #[tokio::test]
    async fn test_edit_exact_match() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");
        std_fs::write(&file_path, "hello world").unwrap();

        let tool = EditTool;
        let ctx = create_context(temp.path());
        let params = json!({
            "filePath": file_path.to_string_lossy(),
            "oldString": "world",
            "newString": "rust"
        });

        tool.execute(params, &ctx).await.unwrap();

        let content = std_fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "hello rust");
    }

    #[tokio::test]
    async fn test_edit_replace_all() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");
        std_fs::write(&file_path, "foo bar foo baz foo").unwrap();

        let tool = EditTool;
        let ctx = create_context(temp.path());
        let params = json!({
            "filePath": file_path.to_string_lossy(),
            "oldString": "foo",
            "newString": "qux",
            "replaceAll": true
        });

        tool.execute(params, &ctx).await.unwrap();

        let content = std_fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "qux bar qux baz qux");
    }

    #[tokio::test]
    async fn test_edit_same_string_error() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");
        std_fs::write(&file_path, "hello").unwrap();

        let tool = EditTool;
        let ctx = create_context(temp.path());
        let params = json!({
            "filePath": file_path.to_string_lossy(),
            "oldString": "hello",
            "newString": "hello"
        });

        let result = tool.execute(params, &ctx).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_create_new_file() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("new_file.txt");

        let tool = EditTool;
        let ctx = create_context(temp.path());
        let params = json!({
            "filePath": file_path.to_string_lossy(),
            "oldString": "",
            "newString": "new content"
        });

        tool.execute(params, &ctx).await.unwrap();

        let content = std_fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "new content");
    }

    #[test]
    fn test_exact_replace() {
        let content = "hello world";
        let result = try_exact_replace(content, "world", "rust", false);
        assert_eq!(result, Some("hello rust".to_string()));
    }

    #[test]
    fn test_multiple_matches_without_replace_all() {
        let content = "foo bar foo";
        let result = try_exact_replace(content, "foo", "baz", false);
        assert_eq!(result, None);
    }

    #[test]
    fn test_replace_all() {
        let content = "foo bar foo";
        let result = try_exact_replace(content, "foo", "baz", true);
        assert_eq!(result, Some("baz bar baz".to_string()));
    }
}
