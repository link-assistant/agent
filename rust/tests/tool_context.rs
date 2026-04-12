//! Tests for ToolContext.
//!
//! Extracted from the original inline tests in rust/src/tool/context.rs.

use link_assistant_agent::tool::ToolContext;
use std::path::PathBuf;

#[test]
fn test_context_creation() {
    let ctx = ToolContext::new("ses_123", "msg_456", "/home/user/project");
    assert_eq!(ctx.session_id, "ses_123");
    assert_eq!(ctx.message_id, "msg_456");
    assert_eq!(ctx.working_directory, PathBuf::from("/home/user/project"));
}

#[test]
fn test_path_resolution() {
    let ctx = ToolContext::new("ses_123", "msg_456", "/home/user/project");

    // Absolute path stays absolute
    let abs = ctx.resolve_path("/etc/config");
    assert_eq!(abs, PathBuf::from("/etc/config"));

    // Relative path is resolved
    let rel = ctx.resolve_path("src/main.rs");
    assert_eq!(rel, PathBuf::from("/home/user/project/src/main.rs"));
}

#[test]
fn test_relative_path() {
    let ctx = ToolContext::new("ses_123", "msg_456", "/home/user/project");

    let full = PathBuf::from("/home/user/project/src/main.rs");
    assert_eq!(ctx.relative_path(&full), "src/main.rs");

    let outside = PathBuf::from("/etc/config");
    assert_eq!(ctx.relative_path(&outside), "/etc/config");
}
