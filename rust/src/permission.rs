//! Permission system (issue #271).
//!
//! Rust counterpart of `js/src/permission/index.ts`. Re-adds an OpenCode-style
//! permission system that is fully controllable from JSON (input and output),
//! with no TUI.
//!
//! By default the agent runs in **full auto mode** (every action is `allow`), so
//! nothing changes for existing consumers. Opt-in CLI options switch the policy:
//!
//! ```text
//!   --permission-mode auto      (default) allow everything, never ask
//!   --permission-mode plan      read-only planning: deny edits, allow read-only
//!                               shell commands, ask before anything else
//!   --permission-mode readonly  hard read-only: deny edits and any non
//!                               read-only shell command (never asks)
//!   --permission-mode ask       ask before every mutating tool (per-command
//!                               approval driven over JSON)
//!   --permission '<json>'       explicit OpenCode-compatible override merged on
//!                               top of the mode, e.g.
//!                               '{"bash":{"git push*":"ask","*":"allow"},"edit":"ask"}'
//! ```
//!
//! The Rust binary does not yet drive a model agent loop (tools are invoked
//! directly, not through a model), so this module provides the policy core,
//! override parsing/merging, bash evaluation, and the JSON request/response
//! schemas — establishing full parity with the JavaScript policy semantics and
//! the documented JSON protocol. The enforcement wiring lives in the JS agent
//! loop; once the Rust binary grows a model loop it can call `evaluate_bash` /
//! `Policy::action_for` at the same tool boundaries.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Env var that overrides the default permission mode.
pub const PERMISSION_MODE_ENV: &str = "LINK_ASSISTANT_AGENT_PERMISSION_MODE";

/// Env var that supplies the default `--permission` JSON override.
pub const PERMISSION_ENV: &str = "LINK_ASSISTANT_AGENT_PERMISSION";

/// Default permission mode when nothing is supplied.
pub const DEFAULT_PERMISSION_MODE: &str = "auto";

/// Default permission mode, honoring the env override (used as the clap default).
pub fn default_permission_mode_from_env(getenv: impl Fn(&str) -> Option<String>) -> String {
    getenv(PERMISSION_MODE_ENV)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_PERMISSION_MODE.to_string())
}

/// Default permission mode, reading the process environment.
pub fn default_permission_mode() -> String {
    default_permission_mode_from_env(|key| std::env::var(key).ok())
}

/// Default `--permission` JSON override, honoring the env var (clap default).
pub fn default_permission_from_env(getenv: impl Fn(&str) -> Option<String>) -> String {
    getenv(PERMISSION_ENV)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_default()
}

/// Default `--permission` JSON override, reading the process environment.
pub fn default_permission() -> String {
    default_permission_from_env(|key| std::env::var(key).ok())
}

// ─── Policy types ───────────────────────────────────────────────────────────

/// A single permission action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Allow,
    Ask,
    Deny,
}

impl Action {
    pub fn as_str(&self) -> &'static str {
        match self {
            Action::Allow => "allow",
            Action::Ask => "ask",
            Action::Deny => "deny",
        }
    }

    /// Parse an action from a string, mirroring the JS `Action` zod enum.
    pub fn parse(value: &str) -> Result<Action, String> {
        match value {
            "allow" => Ok(Action::Allow),
            "ask" => Ok(Action::Ask),
            "deny" => Ok(Action::Deny),
            other => Err(format!(
                "Invalid permission action \"{}\": expected one of allow, ask, deny",
                other
            )),
        }
    }

    /// Numeric restrictiveness used to pick the strongest action in a chain.
    fn restrictiveness(&self) -> u8 {
        match self {
            Action::Allow => 0,
            Action::Ask => 1,
            Action::Deny => 2,
        }
    }

    fn more_restrictive(self, other: Action) -> Action {
        if other.restrictiveness() > self.restrictiveness() {
            other
        } else {
            self
        }
    }
}

/// Permission mode (base policy selector).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Auto,
    Plan,
    Readonly,
    Ask,
}

impl Mode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Mode::Auto => "auto",
            Mode::Plan => "plan",
            Mode::Readonly => "readonly",
            Mode::Ask => "ask",
        }
    }

    /// Parse a mode from a string, mirroring the JS `Mode` zod enum.
    pub fn parse(value: &str) -> Result<Mode, String> {
        match value {
            "auto" => Ok(Mode::Auto),
            "plan" => Ok(Mode::Plan),
            "readonly" => Ok(Mode::Readonly),
            "ask" => Ok(Mode::Ask),
            other => Err(format!(
                "Invalid permission mode \"{}\": expected one of auto, plan, readonly, ask",
                other
            )),
        }
    }
}

/// Resolved permission policy. `bash` is a pattern map (OpenCode-compatible).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    pub edit: Action,
    pub bash: BTreeMap<String, Action>,
    pub webfetch: Action,
}

/// A partial policy parsed from the `--permission` JSON override.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PartialPolicy {
    pub edit: Option<Action>,
    pub bash: Option<BTreeMap<String, Action>>,
    pub webfetch: Option<Action>,
}

/// Read-only shell allowlist. Commands matching one of these patterns are safe
/// to run in plan/readonly mode; everything else falls back to `fallback`
/// (`ask` for plan, `deny` for readonly).
pub fn readonly_bash(fallback: Action) -> BTreeMap<String, Action> {
    let mut map = BTreeMap::new();
    let allow = &[
        "cat*",
        "cd*",
        "cut*",
        "date*",
        "df*",
        "diff*",
        "dirname*",
        "du*",
        "echo*",
        "env",
        "file *",
        "find *",
        "git diff*",
        "git log*",
        "git show*",
        "git status*",
        "git branch",
        "git branch -v",
        "grep*",
        "head*",
        "hostname*",
        "less*",
        "ls*",
        "more*",
        "printenv*",
        "pwd*",
        "readlink*",
        "realpath*",
        "rg*",
        "sort*",
        "stat*",
        "tail*",
        "tree*",
        "uname*",
        "uniq*",
        "wc*",
        "whereis*",
        "which*",
        "whoami*",
    ];
    for pattern in allow {
        map.insert((*pattern).to_string(), Action::Allow);
    }
    // Read-only command families that have destructive variants:
    let fallbacks = &[
        "find * -delete*",
        "find * -exec*",
        "find * -execdir*",
        "find * -fprint*",
        "find * -fls*",
        "find * -fprintf*",
        "find * -ok*",
        "sort -o*",
        "sort --output*",
        "tree -o*",
    ];
    for pattern in fallbacks {
        map.insert((*pattern).to_string(), fallback);
    }
    // Catch-all:
    map.insert("*".to_string(), fallback);
    map
}

/// Base policy for a mode, before any explicit `--permission` override.
pub fn mode_policy(mode: Mode) -> Policy {
    match mode {
        Mode::Plan => Policy {
            edit: Action::Deny,
            bash: readonly_bash(Action::Ask),
            webfetch: Action::Allow,
        },
        Mode::Readonly => Policy {
            edit: Action::Deny,
            bash: readonly_bash(Action::Deny),
            webfetch: Action::Allow,
        },
        Mode::Ask => {
            let mut bash = BTreeMap::new();
            bash.insert("*".to_string(), Action::Ask);
            Policy {
                edit: Action::Ask,
                bash,
                webfetch: Action::Ask,
            }
        }
        Mode::Auto => {
            let mut bash = BTreeMap::new();
            bash.insert("*".to_string(), Action::Allow);
            Policy {
                edit: Action::Allow,
                bash,
                webfetch: Action::Allow,
            }
        }
    }
}

/// Parse the raw `--permission` JSON string into a partial policy.
pub fn parse_override(raw: Option<&str>) -> Result<PartialPolicy, String> {
    let raw = match raw {
        Some(value) if !value.trim().is_empty() => value,
        _ => return Ok(PartialPolicy::default()),
    };
    let parsed: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid --permission JSON: {}", e))?;
    let obj = match parsed {
        serde_json::Value::Object(map) => map,
        _ => return Err("Invalid --permission JSON: expected an object".to_string()),
    };

    let mut out = PartialPolicy::default();

    if let Some(edit) = obj.get("edit") {
        out.edit = Some(parse_action_value(edit)?);
    }
    if let Some(webfetch) = obj.get("webfetch") {
        out.webfetch = Some(parse_action_value(webfetch)?);
    }
    if let Some(bash) = obj.get("bash") {
        match bash {
            serde_json::Value::String(s) => {
                let mut map = BTreeMap::new();
                map.insert("*".to_string(), Action::parse(s)?);
                out.bash = Some(map);
            }
            serde_json::Value::Object(map) => {
                let mut bash_map = BTreeMap::new();
                for (pattern, value) in map {
                    bash_map.insert(pattern.clone(), parse_action_value(value)?);
                }
                out.bash = Some(bash_map);
            }
            _ => {
                return Err(
                    "Invalid --permission JSON: \"bash\" must be a string or object".to_string(),
                )
            }
        }
    }

    Ok(out)
}

fn parse_action_value(value: &serde_json::Value) -> Result<Action, String> {
    match value {
        serde_json::Value::String(s) => Action::parse(s),
        _ => Err("Invalid permission action: expected a string".to_string()),
    }
}

/// Resolve the active policy from a mode and an optional `--permission` override.
/// Mode defines the base policy and the JSON override is merged on top (override
/// wins; bash maps are merged key-by-key).
pub fn policy(mode: Mode, override_raw: Option<&str>) -> Result<Policy, String> {
    let base = mode_policy(mode);
    let over = parse_override(override_raw)?;
    let mut bash = base.bash;
    if let Some(over_bash) = over.bash {
        for (pattern, action) in over_bash {
            bash.insert(pattern, action);
        }
    }
    Ok(Policy {
        edit: over.edit.unwrap_or(base.edit),
        webfetch: over.webfetch.unwrap_or(base.webfetch),
        bash,
    })
}

impl Policy {
    /// Action for a simple (non-bash) tool type (`edit`/`webfetch`).
    pub fn action_for(&self, tool_type: &str) -> Action {
        match tool_type {
            "edit" => self.edit,
            "webfetch" => self.webfetch,
            _ => Action::Allow,
        }
    }

    /// Whether bash enforcement is active. In the default `auto` mode every
    /// pattern maps to `allow`, so callers can skip the command parse entirely —
    /// preserving zero overhead for the full-auto default.
    pub fn bash_enforced(&self) -> bool {
        self.bash.values().any(|a| *a != Action::Allow)
    }
}

// ─── Wildcard matching (port of js/src/util/wildcard.ts) ─────────────────────

/// Match a string against a glob pattern (`*` = any sequence, `?` = any char).
pub fn wildcard_match(input: &str, pattern: &str) -> bool {
    let mut regex = String::with_capacity(pattern.len() * 2 + 2);
    regex.push('^');
    for ch in pattern.chars() {
        match ch {
            '*' => regex.push_str(".*"),
            '?' => regex.push('.'),
            // Escape regex metacharacters (mirror the JS escape set).
            '.' | '+' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\' => {
                regex.push('\\');
                regex.push(ch);
            }
            other => regex.push(other),
        }
    }
    regex.push('$');
    // The JS matcher uses the `s` (dotAll) flag.
    match regex::RegexBuilder::new(&regex)
        .dot_matches_new_line(true)
        .build()
    {
        Ok(re) => re.is_match(input),
        Err(_) => false,
    }
}

fn match_sequence(items: &[String], patterns: &[&str]) -> bool {
    if patterns.is_empty() {
        return true;
    }
    let (pattern, rest) = (patterns[0], &patterns[1..]);
    if pattern == "*" {
        return match_sequence(items, rest);
    }
    for i in 0..items.len() {
        if wildcard_match(&items[i], pattern) && match_sequence(&items[i + 1..], rest) {
            return true;
        }
    }
    false
}

/// Structured match: `head` against the first pattern token, `tail` against the
/// rest. Patterns are tried sorted by (length asc, key asc) so the longest /
/// last matching rule wins — faithful to the JS `Wildcard.allStructured`.
pub fn match_structured(
    head: &str,
    tail: &[String],
    patterns: &BTreeMap<String, Action>,
) -> Option<Action> {
    let mut sorted: Vec<(&String, &Action)> = patterns.iter().collect();
    sorted.sort_by(|a, b| a.0.len().cmp(&b.0.len()).then_with(|| a.0.cmp(b.0)));
    let mut result = None;
    for (pattern, value) in sorted {
        let parts: Vec<&str> = pattern.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        if !wildcard_match(head, parts[0]) {
            continue;
        }
        if parts.len() == 1 || match_sequence(tail, &parts[1..]) {
            result = Some(*value);
        }
    }
    result
}

// ─── Bash evaluation (port of evaluateBash) ──────────────────────────────────

fn tokenize(segment: &str) -> Vec<String> {
    segment.split_whitespace().map(|s| s.to_string()).collect()
}

/// Result of evaluating a shell command against a bash policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BashEvaluation {
    pub action: Action,
    pub ask_patterns: Vec<String>,
}

/// Evaluate a shell command against a bash pattern map.
///
/// A command is only `allow`ed when every segment (split on `;`, `&&`, `||`,
/// `|`) matches an allow pattern and the command contains no command
/// substitution or output redirection. Otherwise it falls back to the catch-all
/// action (`*`).
pub fn evaluate_bash(command: &str, patterns: &BTreeMap<String, Action>) -> BashEvaluation {
    let fallback = patterns.get("*").copied().unwrap_or(Action::Allow);
    let mut ask_patterns: Vec<String> = Vec::new();

    // Command substitution or output redirection can hide arbitrary writes.
    let has_substitution = command.contains("$(") || command.contains('`');
    let has_redirection = command.contains('>');
    if has_substitution || has_redirection {
        if fallback == Action::Ask {
            ask_patterns.push(command.to_string());
        }
        return BashEvaluation {
            action: fallback,
            ask_patterns,
        };
    }

    let segments: Vec<&str> = split_segments(command);
    if segments.is_empty() {
        return BashEvaluation {
            action: fallback,
            ask_patterns: Vec::new(),
        };
    }

    let mut action = Action::Allow;
    for segment in segments {
        let tokens = tokenize(segment);
        if tokens.is_empty() {
            continue;
        }
        let matched = match_structured(&tokens[0], &tokens[1..], patterns);
        let seg_action = matched.unwrap_or(fallback);
        action = action.more_restrictive(seg_action);
        if seg_action == Action::Ask {
            let sub = tokens[1..].iter().find(|arg| !arg.starts_with('-'));
            let pattern = match sub {
                Some(sub) => format!("{} {} *", tokens[0], sub),
                None => format!("{} *", tokens[0]),
            };
            if !ask_patterns.contains(&pattern) {
                ask_patterns.push(pattern);
            }
        }
    }

    BashEvaluation {
        action,
        ask_patterns,
    }
}

/// Split a shell line on the top-level separators `&&`, `||`, `;`, `|`.
fn split_segments(command: &str) -> Vec<&str> {
    let bytes = command.as_bytes();
    let mut segments = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        let two = &command[i..(i + 2).min(command.len())];
        if two == "&&" || two == "||" {
            segments.push(command[start..i].trim());
            i += 2;
            start = i;
            continue;
        }
        let c = bytes[i];
        if c == b';' || c == b'|' {
            segments.push(command[start..i].trim());
            i += 1;
            start = i;
            continue;
        }
        i += 1;
    }
    segments.push(command[start..].trim());
    segments.into_iter().filter(|s| !s.is_empty()).collect()
}

// ─── JSON protocol structs ───────────────────────────────────────────────────

/// `permission_request` event emitted to stdout when a tool needs approval.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PermissionRequest {
    #[serde(rename = "type")]
    pub event_type: String,
    pub timestamp: u64,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    #[serde(rename = "permissionID")]
    pub permission_id: String,
    #[serde(rename = "callID", skip_serializing_if = "Option::is_none")]
    pub call_id: Option<String>,
    pub tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<Vec<String>>,
    pub title: String,
    pub metadata: serde_json::Value,
}

impl PermissionRequest {
    pub fn new(
        timestamp: u64,
        session_id: impl Into<String>,
        permission_id: impl Into<String>,
        tool: impl Into<String>,
        title: impl Into<String>,
    ) -> Self {
        PermissionRequest {
            event_type: "permission_request".to_string(),
            timestamp,
            session_id: session_id.into(),
            permission_id: permission_id.into(),
            call_id: None,
            tool: tool.into(),
            pattern: None,
            title: title.into(),
            metadata: serde_json::Value::Object(Default::default()),
        }
    }
}

/// A permission response value sent from the consumer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Response {
    Once,
    Always,
    Reject,
}

impl Response {
    pub fn parse(value: &str) -> Result<Response, String> {
        match value {
            "once" => Ok(Response::Once),
            "always" => Ok(Response::Always),
            "reject" => Ok(Response::Reject),
            other => Err(format!(
                "Invalid permission response \"{}\": expected one of once, always, reject",
                other
            )),
        }
    }
}

/// `permission_response` frame read from stdin to resolve a pending request.
/// `permissionID` may also be supplied as `permission_id` (both accepted).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct PermissionResponse {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(rename = "permissionID", alias = "permission_id")]
    pub permission_id: String,
    pub response: Response,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auto() -> Policy {
        policy(Mode::Auto, None).unwrap()
    }

    #[test]
    fn mode_policy_auto_allows_everything() {
        let p = mode_policy(Mode::Auto);
        assert_eq!(p.edit, Action::Allow);
        assert_eq!(p.webfetch, Action::Allow);
        assert_eq!(p.bash.get("*"), Some(&Action::Allow));
        assert!(!p.bash_enforced());
    }

    #[test]
    fn mode_policy_plan_denies_edit_asks_unknown_bash() {
        let p = mode_policy(Mode::Plan);
        assert_eq!(p.edit, Action::Deny);
        assert_eq!(p.webfetch, Action::Allow);
        assert_eq!(p.bash.get("*"), Some(&Action::Ask));
        assert_eq!(p.bash.get("cat*"), Some(&Action::Allow));
        assert!(p.bash_enforced());
    }

    #[test]
    fn mode_policy_readonly_denies_unknown_bash() {
        let p = mode_policy(Mode::Readonly);
        assert_eq!(p.edit, Action::Deny);
        assert_eq!(p.bash.get("*"), Some(&Action::Deny));
        assert_eq!(p.bash.get("ls*"), Some(&Action::Allow));
        assert!(p.bash_enforced());
    }

    #[test]
    fn mode_policy_ask_asks_everything() {
        let p = mode_policy(Mode::Ask);
        assert_eq!(p.edit, Action::Ask);
        assert_eq!(p.webfetch, Action::Ask);
        assert_eq!(p.bash.get("*"), Some(&Action::Ask));
    }

    #[test]
    fn parse_override_empty_is_default() {
        assert_eq!(parse_override(None).unwrap(), PartialPolicy::default());
        assert_eq!(parse_override(Some("")).unwrap(), PartialPolicy::default());
        assert_eq!(
            parse_override(Some("   ")).unwrap(),
            PartialPolicy::default()
        );
    }

    #[test]
    fn parse_override_edit_webfetch_bash_map() {
        let over = parse_override(Some(
            r#"{"edit":"ask","webfetch":"deny","bash":{"git push*":"ask","*":"allow"}}"#,
        ))
        .unwrap();
        assert_eq!(over.edit, Some(Action::Ask));
        assert_eq!(over.webfetch, Some(Action::Deny));
        let bash = over.bash.unwrap();
        assert_eq!(bash.get("git push*"), Some(&Action::Ask));
        assert_eq!(bash.get("*"), Some(&Action::Allow));
    }

    #[test]
    fn parse_override_bare_bash_string() {
        let over = parse_override(Some(r#"{"bash":"ask"}"#)).unwrap();
        let bash = over.bash.unwrap();
        assert_eq!(bash.get("*"), Some(&Action::Ask));
    }

    #[test]
    fn parse_override_invalid_json_errors() {
        assert!(parse_override(Some("{not json")).is_err());
    }

    #[test]
    fn parse_override_invalid_action_errors() {
        assert!(parse_override(Some(r#"{"edit":"maybe"}"#)).is_err());
    }

    #[test]
    fn parse_override_non_object_errors() {
        assert!(parse_override(Some("[1,2,3]")).is_err());
    }

    #[test]
    fn policy_default_is_full_auto() {
        let p = auto();
        assert_eq!(p.edit, Action::Allow);
        assert_eq!(p.action_for("edit"), Action::Allow);
        assert_eq!(p.action_for("webfetch"), Action::Allow);
        assert!(!p.bash_enforced());
    }

    #[test]
    fn policy_merges_override_on_top_of_mode() {
        let p = policy(
            Mode::Plan,
            Some(r#"{"edit":"ask","bash":{"npm*":"allow"}}"#),
        )
        .unwrap();
        // override wins for edit
        assert_eq!(p.edit, Action::Ask);
        // merged key-by-key: base plan bash still present
        assert_eq!(p.bash.get("cat*"), Some(&Action::Allow));
        assert_eq!(p.bash.get("npm*"), Some(&Action::Allow));
        assert_eq!(p.bash.get("*"), Some(&Action::Ask));
    }

    #[test]
    fn evaluate_bash_readonly_chain_allows() {
        let patterns = readonly_bash(Action::Deny);
        let res = evaluate_bash("ls -la && cat file.txt", &patterns);
        assert_eq!(res.action, Action::Allow);
        assert!(res.ask_patterns.is_empty());
    }

    #[test]
    fn evaluate_bash_most_restrictive_wins() {
        let patterns = readonly_bash(Action::Deny);
        let res = evaluate_bash("cat file.txt && rm file.txt", &patterns);
        assert_eq!(res.action, Action::Deny);
    }

    #[test]
    fn evaluate_bash_command_substitution_falls_back() {
        let patterns = readonly_bash(Action::Deny);
        let res = evaluate_bash("echo $(rm -rf /)", &patterns);
        assert_eq!(res.action, Action::Deny);
    }

    #[test]
    fn evaluate_bash_redirection_falls_back() {
        let patterns = readonly_bash(Action::Deny);
        let res = evaluate_bash("cat file.txt > out.txt", &patterns);
        assert_eq!(res.action, Action::Deny);
    }

    #[test]
    fn evaluate_bash_plan_asks_unknown() {
        let patterns = readonly_bash(Action::Ask);
        let res = evaluate_bash("npm install", &patterns);
        assert_eq!(res.action, Action::Ask);
        assert_eq!(res.ask_patterns, vec!["npm install *".to_string()]);
    }

    #[test]
    fn evaluate_bash_find_delete_falls_back() {
        let patterns = readonly_bash(Action::Deny);
        let res = evaluate_bash("find . -name '*.tmp' -delete", &patterns);
        assert_eq!(res.action, Action::Deny);
    }

    #[test]
    fn evaluate_bash_plain_find_allows() {
        let patterns = readonly_bash(Action::Deny);
        let res = evaluate_bash("find . -name '*.rs'", &patterns);
        assert_eq!(res.action, Action::Allow);
    }

    #[test]
    fn wildcard_match_basic() {
        assert!(wildcard_match("git push origin", "git push*"));
        assert!(!wildcard_match("git pull", "git push*"));
        assert!(wildcard_match("anything", "*"));
    }

    #[test]
    fn permission_request_serializes_with_camel_ids() {
        let mut req = PermissionRequest::new(123, "ses_a", "per_b", "bash", "npm install");
        req.pattern = Some(vec!["npm install *".to_string()]);
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["type"], "permission_request");
        assert_eq!(json["sessionID"], "ses_a");
        assert_eq!(json["permissionID"], "per_b");
        assert_eq!(json["tool"], "bash");
        assert_eq!(json["pattern"][0], "npm install *");
        // callID omitted when None
        assert!(json.get("callID").is_none());
    }

    #[test]
    fn permission_response_parses_both_id_keys() {
        let a: PermissionResponse = serde_json::from_str(
            r#"{"type":"permission_response","permissionID":"per_x","response":"once"}"#,
        )
        .unwrap();
        assert_eq!(a.permission_id, "per_x");
        assert_eq!(a.response, Response::Once);

        let b: PermissionResponse = serde_json::from_str(
            r#"{"type":"permission_response","permission_id":"per_y","response":"always"}"#,
        )
        .unwrap();
        assert_eq!(b.permission_id, "per_y");
        assert_eq!(b.response, Response::Always);
    }

    #[test]
    fn response_parse_rejects_unknown() {
        assert!(Response::parse("maybe").is_err());
        assert_eq!(Response::parse("reject").unwrap(), Response::Reject);
    }

    #[test]
    fn mode_and_action_parse_roundtrip() {
        for m in ["auto", "plan", "readonly", "ask"] {
            assert_eq!(Mode::parse(m).unwrap().as_str(), m);
        }
        for a in ["allow", "ask", "deny"] {
            assert_eq!(Action::parse(a).unwrap().as_str(), a);
        }
        assert!(Mode::parse("nope").is_err());
        assert!(Action::parse("nope").is_err());
    }
}
