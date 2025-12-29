//! Grep tool implementation
//!
//! Text search with regex support, matching the JavaScript implementation's grep tool behavior.

use async_trait::async_trait;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Tool description
const DESCRIPTION: &str = r#"A powerful search tool for finding text patterns in files.

Usage:
- Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx")
- Output modes: "content" shows matching lines, "files_with_matches" shows only file paths
- Use -C/-A/-B for context lines around matches"#;

/// Parameters for the grep tool
#[derive(Debug, Deserialize)]
pub struct GrepParams {
    /// The regex pattern to search for
    pub pattern: String,
    /// File or directory to search in
    #[serde(default)]
    pub path: Option<String>,
    /// Glob pattern to filter files
    #[serde(default)]
    pub glob: Option<String>,
    /// Output mode: "content", "files_with_matches", or "count"
    #[serde(default = "default_output_mode")]
    pub output_mode: String,
    /// Case insensitive search
    #[serde(default, rename = "-i")]
    pub case_insensitive: bool,
    /// Show line numbers
    #[serde(default = "default_true", rename = "-n")]
    pub line_numbers: bool,
    /// Lines of context before match
    #[serde(default, rename = "-B")]
    pub context_before: Option<usize>,
    /// Lines of context after match
    #[serde(default, rename = "-A")]
    pub context_after: Option<usize>,
    /// Lines of context around match
    #[serde(default, rename = "-C")]
    pub context: Option<usize>,
    /// Maximum results to return
    #[serde(default)]
    pub head_limit: Option<usize>,
}

fn default_output_mode() -> String {
    "files_with_matches".to_string()
}

fn default_true() -> bool {
    true
}

/// Grep tool implementation
pub struct GrepTool;

#[async_trait]
impl Tool for GrepTool {
    fn id(&self) -> &'static str {
        "grep"
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
                    "description": "The regular expression pattern to search for"
                },
                "path": {
                    "type": "string",
                    "description": "File or directory to search in"
                },
                "glob": {
                    "type": "string",
                    "description": "Glob pattern to filter files"
                },
                "output_mode": {
                    "type": "string",
                    "enum": ["content", "files_with_matches", "count"],
                    "description": "Output mode"
                },
                "-i": {
                    "type": "boolean",
                    "description": "Case insensitive search"
                },
                "-n": {
                    "type": "boolean",
                    "description": "Show line numbers"
                },
                "-B": {
                    "type": "number",
                    "description": "Lines of context before match"
                },
                "-A": {
                    "type": "number",
                    "description": "Lines of context after match"
                },
                "-C": {
                    "type": "number",
                    "description": "Lines of context around match"
                }
            },
            "required": ["pattern"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: GrepParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("grep", e.to_string()))?;

        let search_path = match &params.path {
            Some(p) => ctx.resolve_path(p),
            None => ctx.working_directory.clone(),
        };

        // Build regex
        let pattern = if params.case_insensitive {
            format!("(?i){}", params.pattern)
        } else {
            params.pattern.clone()
        };

        let regex = Regex::new(&pattern)
            .map_err(|e| AgentError::tool_execution("grep", format!("Invalid regex: {}", e)))?;

        let title = params.pattern.clone();

        // Collect files to search
        let files = collect_files(&search_path, params.glob.as_deref())?;

        // Search files
        let mut results = Vec::new();
        let mut match_count = 0;

        let context_before = params.context.or(params.context_before).unwrap_or(0);
        let context_after = params.context.or(params.context_after).unwrap_or(0);

        for file_path in files {
            if let Ok(content) = fs::read_to_string(&file_path) {
                let file_matches = search_file(
                    &content,
                    &regex,
                    &file_path,
                    ctx,
                    &params.output_mode,
                    params.line_numbers,
                    context_before,
                    context_after,
                );

                if !file_matches.is_empty() {
                    match_count += file_matches.len();
                    results.extend(file_matches);

                    if let Some(limit) = params.head_limit {
                        if results.len() >= limit {
                            results.truncate(limit);
                            break;
                        }
                    }
                }
            }
        }

        Ok(ToolResult {
            title,
            output: results.join("\n"),
            metadata: json!({
                "count": match_count,
            }),
            attachments: None,
        })
    }
}

/// Collect files to search based on path and glob filter
fn collect_files(path: &Path, glob_filter: Option<&str>) -> Result<Vec<std::path::PathBuf>> {
    let mut files = Vec::new();

    if path.is_file() {
        files.push(path.to_path_buf());
    } else if path.is_dir() {
        for entry in WalkDir::new(path)
            .follow_links(true)
            .into_iter()
            .filter_entry(|e| {
                // Don't filter the root path itself
                if e.path() == path {
                    return true;
                }
                !is_hidden(e.file_name().to_str().unwrap_or(""))
            })
        {
            if let Ok(entry) = entry {
                if entry.file_type().is_file() {
                    let file_path = entry.path();

                    // Apply glob filter if specified
                    if let Some(pattern) = glob_filter {
                        let name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        if !matches_glob(name, pattern) {
                            continue;
                        }
                    }

                    files.push(file_path.to_path_buf());
                }
            }
        }
    }

    Ok(files)
}

/// Check if a file/directory is hidden
fn is_hidden(name: &str) -> bool {
    name.starts_with('.') && name != "." && name != ".."
}

/// Simple glob matching for common patterns
fn matches_glob(name: &str, pattern: &str) -> bool {
    if pattern.starts_with("*.") {
        let ext = &pattern[1..];
        name.ends_with(ext)
    } else if pattern.starts_with("**/*.") {
        let ext = &pattern[4..];
        name.ends_with(ext)
    } else {
        name == pattern
    }
}

/// Search a file for matches
fn search_file(
    content: &str,
    regex: &Regex,
    file_path: &Path,
    ctx: &ToolContext,
    output_mode: &str,
    show_line_numbers: bool,
    context_before: usize,
    context_after: usize,
) -> Vec<String> {
    let rel_path = ctx.relative_path(&file_path.to_path_buf());
    let lines: Vec<&str> = content.lines().collect();
    let mut results = Vec::new();
    let mut has_match = false;

    for (i, line) in lines.iter().enumerate() {
        if regex.is_match(line) {
            has_match = true;

            match output_mode {
                "content" => {
                    // Add context before
                    let start = i.saturating_sub(context_before);
                    for j in start..i {
                        let line_output = if show_line_numbers {
                            format!("{}:{}: {}", rel_path, j + 1, lines[j])
                        } else {
                            format!("{}: {}", rel_path, lines[j])
                        };
                        results.push(line_output);
                    }

                    // Add matching line
                    let line_output = if show_line_numbers {
                        format!("{}:{}: {}", rel_path, i + 1, line)
                    } else {
                        format!("{}: {}", rel_path, line)
                    };
                    results.push(line_output);

                    // Add context after
                    let end = (i + context_after + 1).min(lines.len());
                    for j in (i + 1)..end {
                        let line_output = if show_line_numbers {
                            format!("{}:{}: {}", rel_path, j + 1, lines[j])
                        } else {
                            format!("{}: {}", rel_path, lines[j])
                        };
                        results.push(line_output);
                    }
                }
                "count" => {
                    // Just count, handled below
                }
                _ => {
                    // files_with_matches - just record file, handled below
                }
            }
        }
    }

    if has_match {
        match output_mode {
            "files_with_matches" => vec![rel_path],
            "count" => {
                let count = lines.iter().filter(|l| regex.is_match(l)).count();
                vec![format!("{}:{}", rel_path, count)]
            }
            _ => results,
        }
    } else {
        vec![]
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
    async fn test_grep_simple() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("test.txt"), "hello world\nfoo bar\nhello again").unwrap();

        let tool = GrepTool;
        let ctx = create_context(temp.path());
        let params = json!({
            "pattern": "hello",
            "output_mode": "content"
        });

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.contains("hello world"));
        assert!(result.output.contains("hello again"));
        assert!(!result.output.contains("foo bar"));
    }

    #[tokio::test]
    async fn test_grep_files_with_matches() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("match.txt"), "hello world").unwrap();
        fs::write(temp.path().join("no_match.txt"), "goodbye world").unwrap();

        let tool = GrepTool;
        let ctx = create_context(temp.path());
        let params = json!({
            "pattern": "hello",
            "output_mode": "files_with_matches"
        });

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.contains("match.txt"));
        assert!(!result.output.contains("no_match.txt"));
    }

    #[tokio::test]
    async fn test_grep_case_insensitive() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("test.txt"), "Hello World\nHELLO WORLD").unwrap();

        let tool = GrepTool;
        let ctx = create_context(temp.path());
        let params = json!({
            "pattern": "hello",
            "-i": true,
            "output_mode": "content"
        });

        let result = tool.execute(params, &ctx).await.unwrap();

        assert!(result.output.contains("Hello World"));
        assert!(result.output.contains("HELLO WORLD"));
    }

    #[test]
    fn test_glob_matching() {
        assert!(matches_glob("file.js", "*.js"));
        assert!(!matches_glob("file.ts", "*.js"));
        assert!(matches_glob("file.tsx", "**/*.tsx"));
    }
}
