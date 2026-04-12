//! Tests for the error module.
//!
//! Extracted from the original inline tests in rust/src/error.rs.

use link_assistant_agent::error::AgentError;

#[test]
fn test_file_not_found_error() {
    let err = AgentError::file_not_found(
        "/path/to/file.txt",
        vec![
            "/path/to/file.ts".to_string(),
            "/path/to/file.js".to_string(),
        ],
    );

    let json = err.to_json();
    assert_eq!(json["name"], "FileNotFound");
    assert_eq!(json["data"]["path"], "/path/to/file.txt");
}

#[test]
fn test_invalid_arguments_error() {
    let err = AgentError::invalid_arguments("read", "filePath is required");

    let json = err.to_json();
    assert_eq!(json["name"], "InvalidArguments");
    assert_eq!(json["data"]["tool"], "read");
}

#[test]
fn test_error_display() {
    let err = AgentError::file_not_found("/test.txt", vec![]);
    assert_eq!(format!("{err}"), "File not found: /test.txt");
}

#[test]
fn test_tool_execution_error() {
    let err = AgentError::tool_execution("edit", "file not writable");
    let json = err.to_json();
    assert_eq!(json["name"], "ToolExecution");
    assert_eq!(json["data"]["tool"], "edit");
}

#[test]
fn test_file_not_found_with_suggestions() {
    let err = AgentError::file_not_found(
        "/path/to/missing.txt",
        vec![
            "/path/to/missing.ts".to_string(),
            "/path/to/missing.js".to_string(),
            "/path/to/missing.rs".to_string(),
        ],
    );

    let json = err.to_json();
    let suggestions = json["data"]["suggestions"].as_array().unwrap();
    assert_eq!(suggestions.len(), 3);
}
