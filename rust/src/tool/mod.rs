//! Tool implementations for the Agent CLI
//!
//! This module provides all the tool implementations that the agent can use,
//! mirroring the JavaScript implementation's tool/ directory.

pub mod context;
pub mod read;
pub mod write;
pub mod edit;
pub mod list;
pub mod glob;
pub mod grep;
pub mod bash;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::Result;
pub use context::ToolContext;

/// Result returned by a tool execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    /// Short title describing what the tool did
    pub title: String,
    /// Main output text
    pub output: String,
    /// Additional metadata about the execution
    #[serde(default)]
    pub metadata: Value,
    /// Optional file attachments (for images, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<FileAttachment>>,
}

/// File attachment for tool results (e.g., images)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAttachment {
    pub id: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    #[serde(rename = "messageID")]
    pub message_id: String,
    #[serde(rename = "type")]
    pub attachment_type: String,
    pub mime: String,
    pub url: String,
}

/// Trait that all tools must implement
#[async_trait]
pub trait Tool: Send + Sync {
    /// Get the tool's unique identifier
    fn id(&self) -> &'static str;

    /// Get the tool's description
    fn description(&self) -> &'static str;

    /// Get the JSON schema for the tool's parameters
    fn parameters_schema(&self) -> Value;

    /// Execute the tool with the given parameters
    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult>;
}

/// Registry of all available tools
pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
}

impl ToolRegistry {
    /// Create a new registry with all built-in tools
    pub fn new() -> Self {
        Self {
            tools: vec![
                Box::new(read::ReadTool),
                Box::new(write::WriteTool),
                Box::new(edit::EditTool),
                Box::new(list::ListTool),
                Box::new(glob::GlobTool),
                Box::new(grep::GrepTool),
                Box::new(bash::BashTool),
            ],
        }
    }

    /// Get a tool by its ID
    pub fn get(&self, id: &str) -> Option<&dyn Tool> {
        self.tools.iter().find(|t| t.id() == id).map(|t| t.as_ref())
    }

    /// Get all registered tools
    pub fn all(&self) -> &[Box<dyn Tool>] {
        &self.tools
    }

    /// Get tool descriptions for system prompt
    pub fn descriptions(&self) -> Vec<(&'static str, &'static str)> {
        self.tools.iter().map(|t| (t.id(), t.description())).collect()
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_creation() {
        let registry = ToolRegistry::new();
        assert!(!registry.all().is_empty());
    }

    #[test]
    fn test_tool_lookup() {
        let registry = ToolRegistry::new();
        assert!(registry.get("read").is_some());
        assert!(registry.get("write").is_some());
        assert!(registry.get("nonexistent").is_none());
    }
}
