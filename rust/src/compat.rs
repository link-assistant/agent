//! Compatibility switches for tool behaviour.
//!
//! The tools follow the JavaScript implementation. Where that changed what an
//! earlier Rust release did, one of these switches restores the earlier
//! behaviour. Each switch is an environment variable with the same name as on
//! the JavaScript side, and the CLI has a matching flag that sets it.
//!
//! The variables are read when a tool runs, not at startup, so a tool context
//! without explicit [`ToolSettings`] always sees the current environment.

use std::collections::BTreeSet;

/// Shell used by the bash tool: `auto` (default), `legacy` (`bash -c`, as
/// before), or a shell path or name.
pub const BASH_SHELL_ENV: &str = "LINK_ASSISTANT_AGENT_BASH_SHELL";
/// `true` restores the earlier tool output formats.
pub const LEGACY_TOOL_OUTPUT_ENV: &str = "LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT";
/// `true` restores the earlier edit matching rules.
pub const LEGACY_EDIT_MATCHING_ENV: &str = "LINK_ASSISTANT_AGENT_LEGACY_EDIT_MATCHING";
/// `true` makes the glob, grep and list walkers follow symbolic links.
pub const GLOB_FOLLOW_SYMLINKS_ENV: &str = "LINK_ASSISTANT_AGENT_GLOB_FOLLOW_SYMLINKS";
/// `false` makes grep skip hidden files and directories.
pub const GREP_HIDDEN_ENV: &str = "LINK_ASSISTANT_AGENT_GREP_HIDDEN";
/// Grep time limit in milliseconds; 0 means no limit.
pub const GREP_TIMEOUT_MS_ENV: &str = "LINK_ASSISTANT_AGENT_GREP_TIMEOUT_MS";
/// Largest `limit` the read tool accepts; 0 means no cap.
pub const READ_MAX_LINES_ENV: &str = "LINK_ASSISTANT_AGENT_READ_MAX_LINES";
/// Largest read output in bytes; 0 means no cap.
pub const READ_MAX_BYTES_ENV: &str = "LINK_ASSISTANT_AGENT_READ_MAX_BYTES";
/// `true` disables the tools that modify files or run commands.
pub const READ_ONLY_ENV: &str = "LINK_ASSISTANT_AGENT_READ_ONLY";
/// Comma-separated tool ids to disable.
pub const DISABLE_TOOLS_ENV: &str = "LINK_ASSISTANT_AGENT_DISABLE_TOOLS";

/// Every switch, for documentation and tests.
pub const ALL_ENV: &[&str] = &[
    BASH_SHELL_ENV,
    LEGACY_TOOL_OUTPUT_ENV,
    LEGACY_EDIT_MATCHING_ENV,
    GLOB_FOLLOW_SYMLINKS_ENV,
    GREP_HIDDEN_ENV,
    GREP_TIMEOUT_MS_ENV,
    READ_MAX_LINES_ENV,
    READ_MAX_BYTES_ENV,
    READ_ONLY_ENV,
    DISABLE_TOOLS_ENV,
];

pub const DEFAULT_BASH_SHELL: &str = "auto";
pub const DEFAULT_GREP_TIMEOUT_MS: u64 = 30_000;
pub const DEFAULT_READ_MAX_LINES: usize = 2000;
pub const DEFAULT_READ_MAX_BYTES: usize = 50 * 1024;

/// Tools denied in read-only mode (JS `ToolRegistry.READ_ONLY_DENIED_TOOLS`).
pub const READ_ONLY_DENIED_TOOLS: &[&str] = &["bash", "edit", "write", "multiedit", "patch"];

/// Parse a boolean the way the JavaScript side does: `true`/`1` and
/// `false`/`0` (any case, surrounding spaces ignored); anything else, or no
/// value, gives `default`.
pub fn parse_bool(value: Option<&str>, default: bool) -> bool {
    match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        Some("true") | Some("1") => true,
        Some("false") | Some("0") => false,
        _ => default,
    }
}

/// Parse a non-negative integer, falling back to `default` when the value is
/// missing or invalid.
pub fn parse_u64(value: Option<&str>, default: u64) -> u64 {
    value
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(default)
}

/// Effective values of every switch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolSettings {
    pub bash_shell: String,
    pub legacy_tool_output: bool,
    pub legacy_edit_matching: bool,
    pub glob_follow_symlinks: bool,
    pub grep_hidden: bool,
    /// 0 means no limit.
    pub grep_timeout_ms: u64,
    /// 0 means no cap.
    pub read_max_lines: usize,
    /// 0 means no cap.
    pub read_max_bytes: usize,
    pub read_only: bool,
    /// Lowercased, trimmed, without empty entries.
    pub disable_tools: Vec<String>,
}

impl Default for ToolSettings {
    fn default() -> Self {
        Self {
            bash_shell: DEFAULT_BASH_SHELL.to_string(),
            legacy_tool_output: false,
            legacy_edit_matching: false,
            glob_follow_symlinks: false,
            grep_hidden: true,
            grep_timeout_ms: DEFAULT_GREP_TIMEOUT_MS,
            read_max_lines: DEFAULT_READ_MAX_LINES,
            read_max_bytes: DEFAULT_READ_MAX_BYTES,
            read_only: false,
            disable_tools: Vec::new(),
        }
    }
}

impl ToolSettings {
    /// Settings from an environment lookup function (testable without
    /// touching the process environment).
    pub fn from_getenv(getenv: impl Fn(&str) -> Option<String>) -> Self {
        let d = Self::default();
        let bool_of = |name: &str, default: bool| parse_bool(getenv(name).as_deref(), default);
        let bash_shell = getenv(BASH_SHELL_ENV)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or(d.bash_shell);
        Self {
            bash_shell,
            legacy_tool_output: bool_of(LEGACY_TOOL_OUTPUT_ENV, d.legacy_tool_output),
            legacy_edit_matching: bool_of(LEGACY_EDIT_MATCHING_ENV, d.legacy_edit_matching),
            glob_follow_symlinks: bool_of(GLOB_FOLLOW_SYMLINKS_ENV, d.glob_follow_symlinks),
            grep_hidden: bool_of(GREP_HIDDEN_ENV, d.grep_hidden),
            grep_timeout_ms: parse_u64(getenv(GREP_TIMEOUT_MS_ENV).as_deref(), d.grep_timeout_ms),
            read_max_lines: parse_u64(
                getenv(READ_MAX_LINES_ENV).as_deref(),
                d.read_max_lines as u64,
            ) as usize,
            read_max_bytes: parse_u64(
                getenv(READ_MAX_BYTES_ENV).as_deref(),
                d.read_max_bytes as u64,
            ) as usize,
            read_only: bool_of(READ_ONLY_ENV, d.read_only),
            disable_tools: parse_tool_list(getenv(DISABLE_TOOLS_ENV).as_deref().unwrap_or("")),
        }
    }

    /// Settings from the process environment, read now.
    pub fn from_env() -> Self {
        Self::from_getenv(|name| std::env::var(name).ok())
    }

    /// The settings that reproduce the tools of the release before the
    /// JavaScript parity work: legacy output and edit matching, `bash -c`,
    /// hidden files skipped by grep, and no grep timeout or read caps.
    pub fn legacy() -> Self {
        Self {
            bash_shell: "legacy".to_string(),
            legacy_tool_output: true,
            legacy_edit_matching: true,
            glob_follow_symlinks: false,
            grep_hidden: false,
            grep_timeout_ms: 0,
            read_max_lines: 0,
            read_max_bytes: 0,
            read_only: false,
            disable_tools: Vec::new(),
        }
    }

    /// Tool ids that must not run: the read-only set when `read_only` is on,
    /// plus `disable_tools` (JS `ToolRegistry.deniedTools`).
    pub fn denied_tools(&self) -> BTreeSet<String> {
        let mut denied: BTreeSet<String> = self.disable_tools.iter().cloned().collect();
        if self.read_only {
            denied.extend(READ_ONLY_DENIED_TOOLS.iter().map(|s| s.to_string()));
        }
        denied
    }

    /// Whether `tool` is denied.
    pub fn is_denied(&self, tool: &str) -> bool {
        let tool = tool.trim().to_ascii_lowercase();
        (self.read_only && READ_ONLY_DENIED_TOOLS.contains(&tool.as_str()))
            || self.disable_tools.iter().any(|t| *t == tool)
    }

    /// `name=value` lines for verbose output.
    pub fn describe(&self) -> Vec<String> {
        vec![
            format!("Bash shell: {}", self.bash_shell),
            format!("Legacy tool output: {}", self.legacy_tool_output),
            format!("Legacy edit matching: {}", self.legacy_edit_matching),
            format!("Glob follow symlinks: {}", self.glob_follow_symlinks),
            format!("Grep hidden: {}", self.grep_hidden),
            format!("Grep timeout: {}ms", self.grep_timeout_ms),
            format!("Read max lines: {}", self.read_max_lines),
            format!("Read max bytes: {}", self.read_max_bytes),
            format!("Read only: {}", self.read_only),
            format!("Disabled tools: {}", self.disable_tools.join(",")),
        ]
    }
}

/// Split a comma-separated tool list, trimming and lowercasing each entry.
pub fn parse_tool_list(list: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in list.split(',') {
        let id = raw.trim().to_ascii_lowercase();
        if !id.is_empty() && !out.contains(&id) {
            out.push(id);
        }
    }
    out
}

/// Current settings from the environment.
pub fn settings() -> ToolSettings {
    ToolSettings::from_env()
}

/// Message used when a denied tool is called (JS batch tool).
pub fn denied_message(tool: &str) -> String {
    format!(
        "Tool '{}' is disabled in read-only / planning mode and cannot be executed.",
        tool
    )
}
