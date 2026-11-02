//! Tests for the todo tools (TodoWrite and TodoRead).
//!
//! Mirrors test coverage from js/tests/integration/todo.tools.test.js
//! and the original inline tests from rust/src/tool/todo.rs.

use link_assistant_agent::tool::todo::{TodoReadTool, TodoWriteTool};
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use tempfile::TempDir;

fn create_context(dir: &std::path::Path, session_id: &str) -> ToolContext {
    ToolContext::new(session_id, "msg_test", dir)
}

#[tokio::test]
async fn test_todo_write_and_read() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path(), "ses_test_todo_wr");

    let write_tool = TodoWriteTool;
    let params = json!({
        "todos": [
            {
                "content": "Fix bug",
                "status": "pending",
                "activeForm": "Fixing bug"
            },
            {
                "content": "Write tests",
                "status": "in_progress",
                "activeForm": "Writing tests"
            }
        ]
    });

    let write_result = write_tool.execute(params, &ctx).await.unwrap();
    assert!(write_result.title.contains("2 todos"));

    let read_tool = TodoReadTool;
    let read_result = read_tool.execute(json!({}), &ctx).await.unwrap();
    assert!(read_result.output.contains("Fix bug"));
    assert!(read_result.output.contains("Write tests"));
}

#[tokio::test]
async fn test_todo_completed_count() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path(), "ses_test_todo_cc");

    let write_tool = TodoWriteTool;
    let params = json!({
        "todos": [
            {
                "content": "Done task",
                "status": "completed",
                "activeForm": "Completing task"
            },
            {
                "content": "Pending task",
                "status": "pending",
                "activeForm": "Doing pending task"
            }
        ]
    });

    let result = write_tool.execute(params, &ctx).await.unwrap();
    // Only 1 non-completed todo
    assert!(result.title.contains("1 todos"));
}

// --- Additional tests matching JS todo tool coverage ---

#[tokio::test]
async fn test_todo_read_empty() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path(), "ses_test_todo_empty");

    let read_tool = TodoReadTool;
    let result = read_tool.execute(json!({}), &ctx).await.unwrap();

    // Should return empty or "no todos" message
    assert!(!result.title.is_empty());
}

#[tokio::test]
async fn test_todo_overwrite_list() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path(), "ses_test_todo_ow");

    let write_tool = TodoWriteTool;

    // Write initial todos
    let params1 = json!({
        "todos": [
            {
                "content": "Task A",
                "status": "pending",
                "activeForm": "Doing A"
            }
        ]
    });
    write_tool.execute(params1, &ctx).await.unwrap();

    // Overwrite with new todos
    let params2 = json!({
        "todos": [
            {
                "content": "Task B",
                "status": "pending",
                "activeForm": "Doing B"
            },
            {
                "content": "Task C",
                "status": "in_progress",
                "activeForm": "Doing C"
            }
        ]
    });
    write_tool.execute(params2, &ctx).await.unwrap();

    // Read should show only the new todos
    let read_tool = TodoReadTool;
    let result = read_tool.execute(json!({}), &ctx).await.unwrap();
    assert!(result.output.contains("Task B"));
    assert!(result.output.contains("Task C"));
    assert!(!result.output.contains("Task A"));
}

#[tokio::test]
async fn test_todo_with_all_statuses() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path(), "ses_test_todo_statuses");

    let write_tool = TodoWriteTool;
    let params = json!({
        "todos": [
            {
                "content": "Pending item",
                "status": "pending",
                "activeForm": "Pending"
            },
            {
                "content": "In progress item",
                "status": "in_progress",
                "activeForm": "In progress"
            },
            {
                "content": "Completed item",
                "status": "completed",
                "activeForm": "Completed"
            }
        ]
    });

    let result = write_tool.execute(params, &ctx).await.unwrap();
    // Title should reflect non-completed count (2 pending/in_progress)
    assert!(result.title.contains("2 todos"));
}

#[test]
fn test_todowrite_tool_id() {
    let tool = TodoWriteTool;
    assert_eq!(tool.id(), "todowrite");
}

#[test]
fn test_todoread_tool_id() {
    let tool = TodoReadTool;
    assert_eq!(tool.id(), "todoread");
}

/// The JS schema: content, status (any string, including cancelled),
/// priority and id, without activeForm.
#[tokio::test]
async fn test_todo_accepts_js_schema() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path(), "ses_test_todo_js");
    let todos = json!([
        {"content": "Fix bug", "status": "cancelled", "priority": "high", "id": "1"},
        {"content": "Ship", "status": "completed", "priority": "low", "id": "2"},
        {"content": "Later", "status": "blocked", "priority": "medium", "id": "3"}
    ]);
    let result = TodoWriteTool
        .execute(json!({ "todos": todos }), &ctx)
        .await
        .unwrap();
    // JS counts every status other than "completed".
    assert_eq!(result.title, "2 todos");
    // The list is written back as given, as JS does.
    assert_eq!(result.metadata["todos"], todos);
    let output: serde_json::Value = serde_json::from_str(&result.output).unwrap();
    assert_eq!(output, todos);

    let read = TodoReadTool.execute(json!({}), &ctx).await.unwrap();
    assert_eq!(read.metadata["todos"], todos);
}

/// The earlier Rust shape with activeForm still works and round-trips.
#[tokio::test]
async fn test_todo_keeps_active_form_shape() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path(), "ses_test_todo_active_form");
    let todos = json!([
        {"content": "Fix bug", "status": "in_progress", "activeForm": "Fixing bug"}
    ]);
    let result = TodoWriteTool
        .execute(json!({ "todos": todos }), &ctx)
        .await
        .unwrap();
    assert_eq!(result.metadata["todos"], todos);
}

#[test]
fn test_todowrite_schema_matches_js() {
    let schema = TodoWriteTool.parameters_schema();
    let item = &schema["properties"]["todos"]["items"];
    for key in ["content", "status", "priority", "id", "activeForm"] {
        assert!(item["properties"][key].is_object(), "missing {}", key);
    }
    assert_eq!(item["properties"]["status"].get("enum"), None);
    assert_eq!(item["required"], json!(["content", "status"]));
}
