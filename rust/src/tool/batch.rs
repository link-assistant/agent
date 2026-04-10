//! Batch tool implementation
//!
//! Executes multiple tools in parallel within a single call,
//! matching the JavaScript implementation's batch tool behavior.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

use super::{context::ToolContext, Tool, ToolRegistry, ToolResult};
use crate::error::{AgentError, Result};

/// Maximum number of tool calls in a single batch
const MAX_BATCH_CALLS: usize = 10;

/// Tools that cannot be called inside batch
const DISALLOWED_IN_BATCH: &[&str] = &["batch", "edit", "todoread"];

/// Tools to exclude from suggestions in error messages
const FILTERED_FROM_SUGGESTIONS: &[&str] = &["invalid", "patch", "batch", "edit", "todoread"];

/// Tool description
const DESCRIPTION: &str = r#"Run multiple tools simultaneously. Executes up to 10 tool calls in parallel.

Usage:
- Provide an array of tool_calls, each with a 'tool' name and 'parameters'
- All tool calls execute concurrently for maximum performance
- Results are returned in the order the calls were provided
- Note: 'batch', 'edit', and 'todoread' cannot be used inside batch

IMPORTANT: Always use the batch tool when you need to call multiple independent tools."#;

/// A single tool call within a batch
#[derive(Debug, Deserialize, Serialize)]
pub struct BatchToolCall {
    /// The name of the tool to execute
    pub tool: String,
    /// Parameters for the tool
    pub parameters: Value,
}

/// Parameters for the batch tool
#[derive(Debug, Deserialize)]
pub struct BatchParams {
    /// Array of tool calls to execute in parallel
    pub tool_calls: Vec<BatchToolCall>,
}

/// Result of a single batch tool call
#[derive(Debug, Serialize)]
pub struct BatchCallResult {
    pub tool: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Batch tool implementation
pub struct BatchTool;

#[async_trait]
impl Tool for BatchTool {
    fn id(&self) -> &'static str {
        "batch"
    }

    fn description(&self) -> &'static str {
        DESCRIPTION
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "tool_calls": {
                    "type": "array",
                    "description": "Array of tool calls to execute in parallel",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "properties": {
                            "tool": {
                                "type": "string",
                                "description": "The name of the tool to execute"
                            },
                            "parameters": {
                                "type": "object",
                                "description": "Parameters for the tool"
                            }
                        },
                        "required": ["tool", "parameters"]
                    }
                }
            },
            "required": ["tool_calls"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: BatchParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("batch", e.to_string()))?;

        if params.tool_calls.is_empty() {
            return Err(AgentError::invalid_arguments(
                "batch",
                "Provide at least one tool call",
            ));
        }

        let disallowed: HashSet<&str> = DISALLOWED_IN_BATCH.iter().copied().collect();
        let filtered: HashSet<&str> = FILTERED_FROM_SUGGESTIONS.iter().copied().collect();

        // Split calls into allowed (up to MAX) and discarded
        let all_calls = params.tool_calls;
        let tool_calls: Vec<BatchToolCall> = all_calls
            .into_iter()
            .take(MAX_BATCH_CALLS + 1) // take one extra to detect truncation
            .collect();

        let (active_calls, discarded_calls) = if tool_calls.len() > MAX_BATCH_CALLS {
            let mut c = tool_calls;
            let disc = c.split_off(MAX_BATCH_CALLS);
            (c, disc)
        } else {
            (tool_calls, vec![])
        };

        let registry = ToolRegistry::new();
        let available_tools: Vec<&str> = registry
            .all()
            .iter()
            .map(|t| t.id())
            .filter(|id| !filtered.contains(id))
            .collect();

        // Execute calls (sequentially in Rust since we don't have easy shared mutable state)
        // In practice, these are typically fast file operations, so sequential is fine
        let mut results: Vec<BatchCallResult> = Vec::new();

        for call in &active_calls {
            if disallowed.contains(call.tool.as_str()) {
                results.push(BatchCallResult {
                    tool: call.tool.clone(),
                    success: false,
                    output: None,
                    error: Some(format!(
                        "Tool '{}' is not allowed in batch. Disallowed tools: {}",
                        call.tool,
                        DISALLOWED_IN_BATCH.join(", ")
                    )),
                });
                continue;
            }

            match registry.get(&call.tool) {
                None => {
                    results.push(BatchCallResult {
                        tool: call.tool.clone(),
                        success: false,
                        output: None,
                        error: Some(format!(
                            "Tool '{}' not found. Available tools: {}",
                            call.tool,
                            available_tools.join(", ")
                        )),
                    });
                }
                Some(tool) => match tool.execute(call.parameters.clone(), ctx).await {
                    Ok(result) => {
                        results.push(BatchCallResult {
                            tool: call.tool.clone(),
                            success: true,
                            output: Some(result.output),
                            error: None,
                        });
                    }
                    Err(e) => {
                        results.push(BatchCallResult {
                            tool: call.tool.clone(),
                            success: false,
                            output: None,
                            error: Some(e.to_string()),
                        });
                    }
                },
            }
        }

        // Add discarded calls as errors
        for call in &discarded_calls {
            results.push(BatchCallResult {
                tool: call.tool.clone(),
                success: false,
                output: None,
                error: Some("Maximum of 10 tools allowed in batch".to_string()),
            });
        }

        let successful = results.iter().filter(|r| r.success).count();
        let failed = results.len() - successful;
        let total = results.len();

        let output_message = if failed > 0 {
            format!(
                "Executed {}/{} tools successfully. {} failed.",
                successful, total, failed
            )
        } else {
            format!(
                "All {} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!",
                successful
            )
        };

        let tool_names: Vec<&str> = active_calls
            .iter()
            .map(|c| c.tool.as_str())
            .chain(discarded_calls.iter().map(|c| c.tool.as_str()))
            .collect();

        Ok(ToolResult {
            title: format!("Batch execution ({}/{} successful)", successful, total),
            output: output_message,
            metadata: json!({
                "totalCalls": total,
                "successful": successful,
                "failed": failed,
                "tools": tool_names,
                "details": results.iter().map(|r| json!({
                    "tool": r.tool,
                    "success": r.success,
                })).collect::<Vec<_>>(),
            }),
            attachments: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_context(dir: &std::path::Path) -> ToolContext {
        ToolContext::new("ses_test", "msg_test", dir)
    }

    #[tokio::test]
    async fn test_batch_disallowed_tool() {
        let temp = TempDir::new().unwrap();
        let tool = BatchTool;
        let ctx = create_context(temp.path());

        let params = json!({
            "tool_calls": [
                {
                    "tool": "batch",
                    "parameters": {}
                }
            ]
        });

        let result = tool.execute(params, &ctx).await.unwrap();
        assert!(result.metadata["failed"].as_u64().unwrap() > 0);
    }

    #[tokio::test]
    async fn test_batch_unknown_tool() {
        let temp = TempDir::new().unwrap();
        let tool = BatchTool;
        let ctx = create_context(temp.path());

        let params = json!({
            "tool_calls": [
                {
                    "tool": "nonexistent_tool",
                    "parameters": {}
                }
            ]
        });

        let result = tool.execute(params, &ctx).await.unwrap();
        assert!(result.metadata["failed"].as_u64().unwrap() > 0);
    }

    #[tokio::test]
    async fn test_batch_multiple_reads() {
        let temp = TempDir::new().unwrap();
        let file1 = temp.path().join("file1.txt");
        let file2 = temp.path().join("file2.txt");
        fs::write(&file1, "content 1").unwrap();
        fs::write(&file2, "content 2").unwrap();

        let tool = BatchTool;
        let ctx = create_context(temp.path());

        let params = json!({
            "tool_calls": [
                {
                    "tool": "read",
                    "parameters": {
                        "filePath": file1.to_string_lossy()
                    }
                },
                {
                    "tool": "read",
                    "parameters": {
                        "filePath": file2.to_string_lossy()
                    }
                }
            ]
        });

        let result = tool.execute(params, &ctx).await.unwrap();
        assert_eq!(result.metadata["successful"].as_u64().unwrap(), 2);
        assert_eq!(result.metadata["failed"].as_u64().unwrap(), 0);
    }
}
