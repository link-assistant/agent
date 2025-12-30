//! Error types for the Agent CLI
//!
//! Provides structured error types that mirror the JavaScript implementation's
//! NamedError pattern, enabling consistent error handling across both implementations.

use thiserror::Error;

/// Main result type for the agent CLI
pub type Result<T> = std::result::Result<T, AgentError>;

/// Agent-specific errors with structured data
#[derive(Error, Debug)]
pub enum AgentError {
    #[error("File not found: {path}")]
    FileNotFound {
        path: String,
        suggestions: Vec<String>,
    },

    #[error("Cannot read binary file: {path}")]
    BinaryFile { path: String },

    #[error("Invalid arguments for tool '{tool}': {message}")]
    InvalidArguments { tool: String, message: String },

    #[error("Tool execution failed: {message}")]
    ToolExecution { tool: String, message: String },

    #[error("Provider initialization failed: {provider}")]
    ProviderInit { provider: String, message: String },

    #[error("Authentication error: {message}")]
    Authentication { message: String },

    #[error("Session error: {message}")]
    Session {
        session_id: Option<String>,
        message: String,
    },

    #[error("Configuration error: {message}")]
    Config { message: String },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl AgentError {
    /// Create a new FileNotFound error with suggestions
    pub fn file_not_found(path: impl Into<String>, suggestions: Vec<String>) -> Self {
        Self::FileNotFound {
            path: path.into(),
            suggestions,
        }
    }

    /// Create a new InvalidArguments error
    pub fn invalid_arguments(tool: impl Into<String>, message: impl Into<String>) -> Self {
        Self::InvalidArguments {
            tool: tool.into(),
            message: message.into(),
        }
    }

    /// Create a new ToolExecution error
    pub fn tool_execution(tool: impl Into<String>, message: impl Into<String>) -> Self {
        Self::ToolExecution {
            tool: tool.into(),
            message: message.into(),
        }
    }

    /// Convert to JSON-serializable error object
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Self::FileNotFound { path, suggestions } => {
                let mut msg = format!("File not found: {path}");
                if !suggestions.is_empty() {
                    msg.push_str("\n\nDid you mean one of these?\n");
                    msg.push_str(&suggestions.join("\n"));
                }
                serde_json::json!({
                    "name": "FileNotFound",
                    "data": {
                        "path": path,
                        "suggestions": suggestions,
                        "message": msg,
                    }
                })
            }
            Self::BinaryFile { path } => serde_json::json!({
                "name": "BinaryFile",
                "data": {
                    "path": path,
                    "message": format!("Cannot read binary file: {path}"),
                }
            }),
            Self::InvalidArguments { tool, message } => serde_json::json!({
                "name": "InvalidArguments",
                "data": {
                    "tool": tool,
                    "message": message,
                }
            }),
            Self::ToolExecution { tool, message } => serde_json::json!({
                "name": "ToolExecution",
                "data": {
                    "tool": tool,
                    "message": message,
                }
            }),
            Self::ProviderInit { provider, message } => serde_json::json!({
                "name": "ProviderInitError",
                "data": {
                    "provider": provider,
                    "message": message,
                }
            }),
            Self::Authentication { message } => serde_json::json!({
                "name": "AuthenticationError",
                "data": {
                    "message": message,
                }
            }),
            Self::Session {
                session_id,
                message,
            } => serde_json::json!({
                "name": "SessionError",
                "data": {
                    "sessionID": session_id,
                    "message": message,
                }
            }),
            Self::Config { message } => serde_json::json!({
                "name": "ConfigError",
                "data": {
                    "message": message,
                }
            }),
            Self::Io(e) => serde_json::json!({
                "name": "IOError",
                "data": {
                    "message": e.to_string(),
                }
            }),
            Self::Json(e) => serde_json::json!({
                "name": "JSONError",
                "data": {
                    "message": e.to_string(),
                }
            }),
            Self::Http(e) => serde_json::json!({
                "name": "HTTPError",
                "data": {
                    "message": e.to_string(),
                }
            }),
            Self::Unknown(msg) => serde_json::json!({
                "name": "UnknownError",
                "data": {
                    "message": msg,
                }
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
