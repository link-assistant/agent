//! MultiEdit tool implementation
//!
//! Performs multiple sequential edit operations on a file,
//! matching the JavaScript implementation's multiedit tool behavior.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{context::ToolContext, edit::EditTool, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// A single edit operation within a multiedit call
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditOperation {
    /// The absolute path to the file to modify
    pub file_path: String,
    /// The text to replace
    pub old_string: String,
    /// The text to replace it with
    pub new_string: String,
    /// Replace all occurrences (default false)
    #[serde(default)]
    pub replace_all: bool,
}

/// Parameters for the multiedit tool
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiEditParams {
    /// The absolute path to the file to modify
    pub file_path: String,
    /// Array of edit operations to perform sequentially on the file
    pub edits: Vec<EditOperation>,
}

/// MultiEdit tool implementation
pub struct MultiEditTool;

#[async_trait]
impl Tool for MultiEditTool {
    fn id(&self) -> &'static str {
        "multiedit"
    }

    fn description(&self) -> &'static str {
        "This is a tool for making multiple edits to a single file in one operation. Use this tool instead of calling the edit tool multiple times when making sequential edits to the same file. This helps maintain consistency and reduces the number of API calls needed."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "filePath": {
                    "type": "string",
                    "description": "The absolute path to the file to modify"
                },
                "edits": {
                    "type": "array",
                    "description": "Array of edit operations to perform sequentially on the file",
                    "items": {
                        "type": "object",
                        "properties": {
                            "filePath": {
                                "type": "string",
                                "description": "The absolute path to the file to modify"
                            },
                            "oldString": {
                                "type": "string",
                                "description": "The text to replace"
                            },
                            "newString": {
                                "type": "string",
                                "description": "The text to replace it with (must be different from oldString)"
                            },
                            "replaceAll": {
                                "type": "boolean",
                                "description": "Replace all occurrences of oldString (default false)"
                            }
                        },
                        "required": ["filePath", "oldString", "newString"]
                    }
                }
            },
            "required": ["filePath", "edits"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: MultiEditParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("multiedit", e.to_string()))?;

        let edit_tool = EditTool;
        let mut results = Vec::new();

        for edit in &params.edits {
            let edit_params = json!({
                "filePath": params.file_path,
                "oldString": edit.old_string,
                "newString": edit.new_string,
                "replaceAll": edit.replace_all,
            });

            let result = edit_tool.execute(edit_params, ctx).await?;
            results.push(result);
        }

        let title = ctx.relative_path(&ctx.resolve_path(&params.file_path));

        let last_output = results.last().map(|r| r.output.clone()).unwrap_or_default();
        let metadata_results: Vec<Value> = results.iter().map(|r| r.metadata.clone()).collect();

        Ok(ToolResult {
            title,
            output: last_output,
            metadata: json!({
                "results": metadata_results,
            }),
            attachments: None,
        })
    }
}
