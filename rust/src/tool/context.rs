//! Tool execution context
//!
//! Provides the execution context passed to tools, containing session information
//! and utilities for tool execution.

use std::path::{Path, PathBuf};

/// Context passed to tool executions
#[derive(Debug, Clone)]
pub struct ToolContext {
    /// Current session ID
    pub session_id: String,
    /// Current message ID
    pub message_id: String,
    /// Agent identifier
    pub agent: String,
    /// Working directory for file operations
    pub working_directory: PathBuf,
    /// Optional call ID for tracking
    pub call_id: Option<String>,
    /// Provider ID being used
    pub provider_id: Option<String>,
    /// Model ID being used
    pub model_id: Option<String>,
}

impl ToolContext {
    /// Create a new tool context
    pub fn new(
        session_id: impl Into<String>,
        message_id: impl Into<String>,
        working_directory: impl Into<PathBuf>,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            message_id: message_id.into(),
            agent: "agent".to_string(),
            working_directory: working_directory.into(),
            call_id: None,
            provider_id: None,
            model_id: None,
        }
    }

    /// Set the call ID
    pub fn with_call_id(mut self, call_id: impl Into<String>) -> Self {
        self.call_id = Some(call_id.into());
        self
    }

    /// Set the provider and model IDs
    pub fn with_model(
        mut self,
        provider_id: impl Into<String>,
        model_id: impl Into<String>,
    ) -> Self {
        self.provider_id = Some(provider_id.into());
        self.model_id = Some(model_id.into());
        self
    }

    /// Resolve a path relative to the working directory
    pub fn resolve_path(&self, path: &str) -> PathBuf {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            path
        } else {
            self.working_directory.join(path)
        }
    }

    /// Get relative path from working directory
    pub fn relative_path(&self, path: &Path) -> String {
        path.strip_prefix(&self.working_directory)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string_lossy().to_string())
    }
}
