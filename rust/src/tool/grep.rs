//! Grep tool implementation
//!
//! Text search with regex support, matching the JavaScript implementation's
//! grep tool, which runs ripgrep:
//!
//! - files are walked like `rg --hidden`: `.gitignore`/`.ignore` rules apply,
//!   `.git` is skipped and symlinks are not followed;
//! - `include` (JS) or `glob` filters files with rg `--glob` semantics: a
//!   pattern without `/` matches the file name at any depth;
//! - without `output_mode` the result is the JS listing: "Found N matches",
//!   grouped by file, newest file first, at most 100 matches, "No files
//!   found" when nothing matches, metadata `{matches, truncated}`;
//! - a missing path or an empty pattern is an error, and the search stops
//!   after `LINK_ASSISTANT_AGENT_GREP_TIMEOUT_MS` (30 s, 0 = no limit).
//!
//! An explicit `output_mode` (`content`, `files_with_matches`, `count`) keeps
//! the earlier Rust formats. `LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT=true`
//! restores the earlier default (`files_with_matches`), the earlier walk (no
//! ignore files, symlinks followed, `glob` matched against the file name)
//! and an empty result for a missing path. `LINK_ASSISTANT_AGENT_GREP_HIDDEN`
//! decides whether dotfiles are searched.

use async_trait::async_trait;
use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::cmp::Reverse;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, UNIX_EPOCH};

use super::text_window::{
    byte_offset_to_char_index, format_balanced_line_window, format_focused_line_window,
};
use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Maximum matching line length before omitting columns
const MAX_MATCHING_LINE_LENGTH: usize = 2000;

/// Matches listed by the default (JS) output
const MATCH_LIMIT: usize = 100;

const NO_FILES_FOUND: &str = "No files found";
const TRUNCATED_NOTE: &str =
    "(Results are truncated. Consider using a more specific path or pattern.)";
const INACCESSIBLE_NOTE: &str = "(Some paths were inaccessible and skipped)";

/// Lines searched between two checks of the timeout.
const LINES_PER_CHECK: usize = 4096;

/// Tool description
const DESCRIPTION: &str = r#"- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\s+\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths with at least one match sorted by modification time
- Long matching lines are summarized around the match with omitted-column ranges, so the matching text remains visible without dumping the whole line.
- Use this tool when you need to find files containing specific patterns
- Optional output_mode ("content", "files_with_matches", "count") with -i, -n, -A/-B/-C and head_limit gives the per-line formats instead"#;

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
    /// Glob pattern to filter files (the JS name of `glob`)
    #[serde(default)]
    pub include: Option<String>,
    /// Output mode: "content", "files_with_matches", or "count". Without it
    /// the JS listing is returned.
    #[serde(default)]
    pub output_mode: Option<String>,
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
                    "description": "The regex pattern to search for in file contents"
                },
                "path": {
                    "type": "string",
                    "description": "The directory to search in. Defaults to the current working directory."
                },
                "include": {
                    "type": "string",
                    "description": "File pattern to include in the search (e.g. \"*.js\", \"*.{ts,tsx}\")"
                },
                "glob": {
                    "type": "string",
                    "description": "Glob pattern to filter files (same as include)"
                },
                "output_mode": {
                    "type": "string",
                    "enum": ["content", "files_with_matches", "count"],
                    "description": "Output mode. Omit it for matches grouped by file, newest first"
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
                },
                "head_limit": {
                    "type": "number",
                    "description": "Maximum results to return"
                }
            },
            "required": ["pattern"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: GrepParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("grep", e.to_string()))?;
        let settings = ctx.settings();
        let legacy = settings.legacy_tool_output;

        if params.pattern.is_empty() && !legacy {
            return Err(AgentError::tool_execution("grep", "pattern is required"));
        }

        let search_path = match &params.path {
            Some(p) if !p.is_empty() => ctx.resolve_path(p),
            _ => ctx.working_directory.clone(),
        };
        // upstream 8f4b62eb49 (#35337)
        if !legacy && fs::metadata(&search_path).is_err() {
            return Err(AgentError::tool_execution(
                "grep",
                format!("Search path does not exist: {}", search_path.display()),
            ));
        }

        let pattern = if params.case_insensitive {
            format!("(?i){}", params.pattern)
        } else {
            params.pattern.clone()
        };
        let regex = Regex::new(&pattern).map_err(|e| {
            AgentError::tool_execution("grep", format!("Invalid regex pattern: {}", e))
        })?;

        let title = params.pattern.clone();
        let filter = params
            .glob
            .clone()
            .or_else(|| params.include.clone())
            .filter(|g| !g.trim().is_empty());
        let walk = WalkOptions {
            root: search_path,
            working_directory: ctx.working_directory.clone(),
            filter,
            hidden: settings.grep_hidden,
            legacy,
        };
        let output_mode = params
            .output_mode
            .clone()
            .or_else(|| legacy.then(|| "files_with_matches".to_string()));

        let timeout_ms = settings.grep_timeout_ms;
        let stop = Stop {
            deadline: (timeout_ms > 0).then(|| Instant::now() + Duration::from_millis(timeout_ms)),
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        // Stops the blocking search when this call is dropped (cancelled).
        let _cancel_on_drop = CancelOnDrop(stop.cancelled.clone());

        let job = tokio::task::spawn_blocking(move || match output_mode {
            None => search_listing(&walk, &regex, params.head_limit, &stop),
            Some(mode) => search_modes(&walk, &regex, &mode, &params, &stop),
        });
        let outcome = job
            .await
            .map_err(|e| AgentError::tool_execution("grep", e.to_string()))?;

        match outcome {
            Ok((output, metadata)) => Ok(ToolResult {
                is_error: false,
                title,
                output,
                metadata,
                attachments: None,
            }),
            Err(Interrupted::TimedOut) => Err(AgentError::tool_execution(
                "grep",
                format!(
                    "Search timed out after {} seconds. Consider using a more specific path or pattern.",
                    timeout_ms as f64 / 1000.0
                ),
            )),
            Err(Interrupted::Cancelled) => {
                Err(AgentError::tool_execution("grep", "Search was cancelled"))
            }
            Err(Interrupted::Invalid(message)) => Err(AgentError::tool_execution("grep", message)),
        }
    }
}

/// Why a search ended early.
enum Interrupted {
    TimedOut,
    Cancelled,
    Invalid(String),
}

type Outcome = std::result::Result<(String, Value), Interrupted>;

/// Deadline and cancellation flag checked while searching.
struct Stop {
    deadline: Option<Instant>,
    cancelled: Arc<AtomicBool>,
}

impl Stop {
    fn check(&self) -> std::result::Result<(), Interrupted> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(Interrupted::Cancelled);
        }
        if self.deadline.is_some_and(|d| Instant::now() >= d) {
            return Err(Interrupted::TimedOut);
        }
        Ok(())
    }
}

struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// Which files to search.
struct WalkOptions {
    root: PathBuf,
    /// Paths of the `output_mode` formats are relative to it
    working_directory: PathBuf,
    filter: Option<String>,
    hidden: bool,
    legacy: bool,
}

/// Call `visit` for each file to search, in file-name order. Returns whether
/// some paths could not be read.
fn walk_files(
    options: &WalkOptions,
    stop: &Stop,
    mut visit: impl FnMut(&Path) -> std::result::Result<(), Interrupted>,
) -> std::result::Result<bool, Interrupted> {
    let root = &options.root;
    let mut builder = WalkBuilder::new(root);
    if options.legacy {
        // The earlier walk: every file, symlinks followed
        builder.standard_filters(false).follow_links(true);
    } else {
        builder.follow_links(false);
        if let Some(glob) = &options.filter {
            let mut overrides = OverrideBuilder::new(root);
            overrides
                .add(glob)
                .map_err(|e| Interrupted::Invalid(format!("Invalid glob '{}': {}", glob, e)))?;
            builder.overrides(
                overrides
                    .build()
                    .map_err(|e| Interrupted::Invalid(format!("Invalid glob '{}': {}", glob, e)))?,
            );
        }
    }
    builder
        .hidden(!options.hidden)
        .sort_by_file_name(|a, b| a.cmp(b))
        .filter_entry(|entry| entry.depth() == 0 || entry.file_name() != ".git");

    let mut had_errors = false;
    for entry in builder.build() {
        stop.check()?;
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                had_errors = true;
                continue;
            }
        };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        // An explicit file is always searched
        if options.legacy && entry.depth() > 0 {
            if let Some(pattern) = &options.filter {
                let name = entry.file_name().to_str().unwrap_or("");
                if !matches_glob(name, pattern) {
                    continue;
                }
            }
        }
        visit(entry.path())?;
    }
    Ok(had_errors)
}

/// One match of the default listing.
struct Found {
    mtime: Reverse<u128>,
    seq: usize,
    path: PathBuf,
    line: String,
}

/// The JS listing: "Found N matches", files newest first, `limit` matches.
fn search_listing(
    walk: &WalkOptions,
    regex: &Regex,
    head_limit: Option<usize>,
    stop: &Stop,
) -> Outcome {
    let limit = head_limit.filter(|n| *n > 0).unwrap_or(MATCH_LIMIT);
    let mut found: Vec<Found> = Vec::new();
    let mut total = 0usize;
    let mut seq = 0usize;
    let mut unreadable = false;
    let sort = |found: &mut Vec<Found>| found.sort_by_key(|f| (f.mtime, f.seq));

    let had_errors = walk_files(walk, stop, |path| {
        let Some(mtime) = fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
        else {
            unreadable = true;
            return Ok(());
        };
        let (count, matches) = match search_file_lines(path, regex, limit, stop) {
            Ok(result) => result,
            Err(FileError::Io) => {
                unreadable = true;
                return Ok(());
            }
            Err(FileError::Stopped(why)) => return Err(why),
        };
        // Lines of one file share its mtime, so only its first `limit` can
        // be listed; the others are only counted.
        total += count;
        for (line_number, line) in matches {
            seq += 1;
            found.push(Found {
                mtime: Reverse(mtime),
                seq,
                path: path.to_path_buf(),
                line: format!("  Line {}: {}", line_number, line),
            });
        }
        // Keep memory bounded: only the first `limit` after sorting survive.
        if found.len() > limit.saturating_mul(4).max(1024) {
            sort(&mut found);
            found.truncate(limit);
        }
        Ok(())
    })?;
    let had_errors = had_errors || unreadable;

    sort(&mut found);
    let truncated = total > limit;
    found.truncate(limit);

    if found.is_empty() {
        let mut output = NO_FILES_FOUND.to_string();
        if had_errors {
            output.push_str("\n\n");
            output.push_str(INACCESSIBLE_NOTE);
        }
        return Ok((output, json!({ "matches": 0, "truncated": false })));
    }

    let mut lines = vec![format!("Found {} matches", found.len())];
    let mut current: Option<&Path> = None;
    for item in &found {
        if current != Some(item.path.as_path()) {
            if current.is_some() {
                lines.push(String::new());
            }
            current = Some(item.path.as_path());
            lines.push(format!("{}:", item.path.display()));
        }
        lines.push(item.line.clone());
    }
    if truncated {
        lines.push(String::new());
        lines.push(TRUNCATED_NOTE.to_string());
    }
    if had_errors {
        lines.push(String::new());
        lines.push(INACCESSIBLE_NOTE.to_string());
    }
    Ok((
        lines.join("\n"),
        json!({ "matches": found.len(), "truncated": truncated }),
    ))
}

enum FileError {
    Io,
    Stopped(Interrupted),
}

/// The number of matching lines of one file and the first `keep` of them as
/// (line number, line summarized around the first match). The file is
/// streamed line by line; a file with a NUL byte is binary and has no
/// matches, as with rg.
fn search_file_lines(
    path: &Path,
    regex: &Regex,
    keep: usize,
    stop: &Stop,
) -> std::result::Result<(usize, Vec<(usize, String)>), FileError> {
    let file = fs::File::open(path).map_err(|_| FileError::Io)?;
    let mut reader = BufReader::new(file);
    let mut buf = Vec::new();
    let mut matches = Vec::new();
    let mut count = 0usize;
    let mut line_number = 0usize;
    loop {
        buf.clear();
        if reader
            .read_until(b'\n', &mut buf)
            .map_err(|_| FileError::Io)?
            == 0
        {
            break;
        }
        line_number += 1;
        if line_number.is_multiple_of(LINES_PER_CHECK) {
            stop.check().map_err(FileError::Stopped)?;
        }
        if buf.contains(&0) {
            return Ok((0, Vec::new()));
        }
        let raw = buf.strip_suffix(b"\n").unwrap_or(&buf);
        let text = String::from_utf8_lossy(raw);
        if let Some(found) = regex.find(&text) {
            count += 1;
            if matches.len() >= keep {
                continue;
            }
            let line = text.strip_suffix('\r').unwrap_or(&text);
            let focus_start = byte_offset_to_char_index(line, found.start());
            let focus_end = byte_offset_to_char_index(line, found.end());
            matches.push((
                line_number,
                format_focused_line_window(
                    line,
                    line_number,
                    focus_start,
                    focus_end,
                    MAX_MATCHING_LINE_LENGTH,
                ),
            ));
        }
    }
    Ok((count, matches))
}

/// The earlier Rust formats, selected with `output_mode`.
fn search_modes(
    walk: &WalkOptions,
    regex: &Regex,
    output_mode: &str,
    params: &GrepParams,
    stop: &Stop,
) -> Outcome {
    let context_before = params.context.or(params.context_before).unwrap_or(0);
    let context_after = params.context.or(params.context_after).unwrap_or(0);

    let mut results: Vec<String> = Vec::new();
    let mut match_count = 0;
    let mut full = false;
    walk_files(walk, stop, |file_path| {
        if full {
            return Ok(());
        }
        let Ok(content) = fs::read_to_string(file_path) else {
            return Ok(());
        };
        let file_matches = search_file(
            &content,
            regex,
            file_path,
            &walk.working_directory,
            output_mode,
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
                    full = true;
                }
            }
        }
        Ok(())
    })?;

    Ok((results.join("\n"), json!({ "count": match_count })))
}

/// Simple glob matching for common patterns (the earlier `glob` filter, kept
/// for legacy output)
pub fn matches_glob(name: &str, pattern: &str) -> bool {
    if let Some(ext) = pattern.strip_prefix('*').filter(|p| p.starts_with('.')) {
        name.ends_with(ext)
    } else if let Some(ext) = pattern.strip_prefix("**/*").filter(|p| p.starts_with('.')) {
        name.ends_with(ext)
    } else {
        name == pattern
    }
}

/// Search a file for matches
#[allow(clippy::too_many_arguments)]
fn search_file(
    content: &str,
    regex: &Regex,
    file_path: &Path,
    working_directory: &Path,
    output_mode: &str,
    show_line_numbers: bool,
    context_before: usize,
    context_after: usize,
) -> Vec<String> {
    let rel_path = file_path
        .strip_prefix(working_directory)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file_path.to_string_lossy().to_string());
    let lines: Vec<&str> = content.lines().collect();
    let mut results = Vec::new();
    let mut has_match = false;

    for (i, line) in lines.iter().enumerate() {
        if regex.is_match(line) {
            has_match = true;

            if output_mode == "content" {
                // Add context before
                let start = i.saturating_sub(context_before);
                for (j, ctx_line) in lines.iter().enumerate().skip(start).take(i - start) {
                    let line_text =
                        format_balanced_line_window(ctx_line, j + 1, MAX_MATCHING_LINE_LENGTH);
                    results.push(numbered(&rel_path, show_line_numbers, j + 1, &line_text));
                }

                // Add matching line
                let matching_line = if let Some(found) = regex.find(line) {
                    let focus_start = byte_offset_to_char_index(line, found.start());
                    let focus_end = byte_offset_to_char_index(line, found.end());
                    format_focused_line_window(
                        line,
                        i + 1,
                        focus_start,
                        focus_end,
                        MAX_MATCHING_LINE_LENGTH,
                    )
                } else {
                    format_balanced_line_window(line, i + 1, MAX_MATCHING_LINE_LENGTH)
                };
                results.push(numbered(
                    &rel_path,
                    show_line_numbers,
                    i + 1,
                    &matching_line,
                ));

                // Add context after
                let end = (i + context_after + 1).min(lines.len());
                for (j, ctx_line) in lines.iter().enumerate().skip(i + 1).take(end - (i + 1)) {
                    let line_text =
                        format_balanced_line_window(ctx_line, j + 1, MAX_MATCHING_LINE_LENGTH);
                    results.push(numbered(&rel_path, show_line_numbers, j + 1, &line_text));
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

fn numbered(path: &str, show_line_numbers: bool, line_number: usize, text: &str) -> String {
    if show_line_numbers {
        format!("{}:{}: {}", path, line_number, text)
    } else {
        format!("{}: {}", path, text)
    }
}
