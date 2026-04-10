//! Invalid tool implementation
//!
//! Handles invalid tool calls with error messages,
//! matching the JavaScript implementation's invalid tool behavior.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Parameters for the invalid tool
#[derive(Debug, Deserialize)]
pub struct InvalidParams {
    /// The tool name that was invalid
    pub tool: String,
    /// The error message
    pub error: String,
}

/// Invalid tool implementation - handles invalid tool call errors
pub struct InvalidTool;

#[async_trait]
impl Tool for InvalidTool {
    fn id(&self) -> &'static str {
        "invalid"
    }

    fn description(&self) -> &'static str {
        "Do not use"
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "tool": {
                    "type": "string"
                },
                "error": {
                    "type": "string"
                }
            },
            "required": ["tool", "error"]
        })
    }

    async fn execute(&self, params: Value, _ctx: &ToolContext) -> Result<ToolResult> {
        let params: InvalidParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("invalid", e.to_string()))?;

        Ok(ToolResult {
            title: "Invalid Tool".to_string(),
            output: format!(
                "The arguments provided to the tool are invalid: {}",
                params.error
            ),
            metadata: json!({}),
            attachments: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_context(dir: &std::path::Path) -> ToolContext {
        ToolContext::new("ses_test", "msg_test", dir)
    }

    #[tokio::test]
    async fn test_invalid_tool() {
        let temp = TempDir::new().unwrap();
        let tool = InvalidTool;
        let ctx = create_context(temp.path());
        let params = json!({
            "tool": "someTool",
            "error": "missing required parameter 'foo'"
        });

        let result = tool.execute(params, &ctx).await.unwrap();

        assert_eq!(result.title, "Invalid Tool");
        assert!(result.output.contains("missing required parameter 'foo'"));
    }
}
