//! Todo tool implementation
//!
//! Provides TodoWrite and TodoRead tools for managing structured task lists,
//! matching the JavaScript implementation's todo tool behavior.
//!
//! Note: In the Rust implementation, todos are stored in-memory within the session
//! context since we don't have a full session storage system like the JS version.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Todo item status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TodoStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "in_progress")]
    InProgress,
    #[serde(rename = "completed")]
    Completed,
}

/// A single todo item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoItem {
    /// Todo content (imperative form, e.g. "Fix bug")
    pub content: String,
    /// Current status
    pub status: TodoStatus,
    /// Present continuous form (e.g. "Fixing bug")
    #[serde(rename = "activeForm")]
    pub active_form: String,
}

/// Global in-memory todo storage (session_id -> todos)
static TODO_STORE: OnceLock<Mutex<HashMap<String, Vec<TodoItem>>>> = OnceLock::new();

fn get_store() -> &'static Mutex<HashMap<String, Vec<TodoItem>>> {
    TODO_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Get todos for a session
pub fn get_todos(session_id: &str) -> Vec<TodoItem> {
    let store = get_store().lock().unwrap();
    store.get(session_id).cloned().unwrap_or_default()
}

/// Update todos for a session
pub fn update_todos(session_id: &str, todos: Vec<TodoItem>) {
    let mut store = get_store().lock().unwrap();
    store.insert(session_id.to_string(), todos);
}

/// Parameters for the TodoWrite tool
#[derive(Debug, Deserialize)]
pub struct TodoWriteParams {
    /// The updated todo list
    pub todos: Vec<TodoItem>,
}

/// TodoWrite tool - creates and updates structured task lists
pub struct TodoWriteTool;

#[async_trait]
impl Tool for TodoWriteTool {
    fn id(&self) -> &'static str {
        "todowrite"
    }

    fn description(&self) -> &'static str {
        "Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "description": "The updated todo list",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "The imperative form of the task"
                            },
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed"]
                            },
                            "activeForm": {
                                "type": "string",
                                "description": "The present continuous form of the task"
                            }
                        },
                        "required": ["content", "status", "activeForm"]
                    }
                }
            },
            "required": ["todos"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: TodoWriteParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("todowrite", e.to_string()))?;

        update_todos(&ctx.session_id, params.todos.clone());

        let pending_count = params
            .todos
            .iter()
            .filter(|t| t.status != TodoStatus::Completed)
            .count();

        let output = serde_json::to_string_pretty(&params.todos).unwrap_or_default();

        Ok(ToolResult {
            title: format!("{} todos", pending_count),
            output,
            metadata: json!({
                "todos": params.todos,
            }),
            attachments: None,
        })
    }
}

/// TodoRead tool - reads the current todo list
pub struct TodoReadTool;

#[async_trait]
impl Tool for TodoReadTool {
    fn id(&self) -> &'static str {
        "todoread"
    }

    fn description(&self) -> &'static str {
        "Use this tool to read your todo list"
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {}
        })
    }

    async fn execute(&self, _params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let todos = get_todos(&ctx.session_id);

        let pending_count = todos
            .iter()
            .filter(|t| t.status != TodoStatus::Completed)
            .count();

        let output = serde_json::to_string_pretty(&todos).unwrap_or_default();

        Ok(ToolResult {
            title: format!("{} todos", pending_count),
            output,
            metadata: json!({
                "todos": todos,
            }),
            attachments: None,
        })
    }
}
