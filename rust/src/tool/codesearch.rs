//! CodeSearch tool implementation
//!
//! Searches for code context and documentation using the Exa MCP API,
//! matching the JavaScript implementation's codesearch tool behavior.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::websearch::{call_exa, exa_mcp_url};
use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

const SEARCH_TIMEOUT_SECS: u64 = 30;
const DEFAULT_TOKENS_NUM: u32 = 5000;
const MIN_TOKENS_NUM: u32 = 1000;
const MAX_TOKENS_NUM: u32 = 50000;

/// Tool description
const DESCRIPTION: &str = r#"Searches for relevant code context, APIs, libraries, and SDK documentation.

Usage:
- Provide a query describing the code you need help with
- Optionally specify token count (1000-50000, default: 5000)
- Returns relevant code examples and documentation

Examples:
- 'React useState hook examples'
- 'Python pandas dataframe filtering'
- 'Express.js middleware'
- 'Next.js partial prerendering configuration'"#;

/// Parameters for the codesearch tool
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchParams {
    /// The search query
    pub query: String,
    /// Number of tokens to return
    #[serde(default)]
    pub tokens_num: Option<u32>,
}

#[derive(Debug, Serialize)]
struct McpCodeRequest {
    jsonrpc: String,
    id: u32,
    method: String,
    params: McpCodeParams,
}

#[derive(Debug, Serialize)]
struct McpCodeParams {
    name: String,
    arguments: McpCodeArguments,
}

#[derive(Debug, Serialize)]
struct McpCodeArguments {
    query: String,
    #[serde(rename = "tokensNum")]
    tokens_num: u32,
}

/// CodeSearch tool implementation
pub struct CodeSearchTool;

#[async_trait]
impl Tool for CodeSearchTool {
    fn id(&self) -> &'static str {
        "codesearch"
    }

    fn description(&self) -> &'static str {
        DESCRIPTION
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query to find relevant context for APIs, Libraries, and SDKs"
                },
                "tokensNum": {
                    "type": "number",
                    "description": "Number of tokens to return (1000-50000). Default is 5000 tokens."
                }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, params: Value, _ctx: &ToolContext) -> Result<ToolResult> {
        let params: CodeSearchParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("codesearch", e.to_string()))?;

        let tokens_num = params
            .tokens_num
            .unwrap_or(DEFAULT_TOKENS_NUM)
            .clamp(MIN_TOKENS_NUM, MAX_TOKENS_NUM);

        let code_request = McpCodeRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "tools/call".to_string(),
            params: McpCodeParams {
                name: "get_code_context_exa".to_string(),
                arguments: McpCodeArguments {
                    query: params.query.clone(),
                    tokens_num,
                },
            },
        };

        let output = call_exa(
            &exa_mcp_url(),
            &code_request,
            SEARCH_TIMEOUT_SECS,
            "codesearch",
            "Code search",
        )
        .await?;

        if let Some(output) = output {
            return Ok(ToolResult {
                is_error: false,
                title: format!("Code search: {}", params.query),
                output,
                metadata: json!({}),
                attachments: None,
            });
        }

        Ok(ToolResult {
            is_error: false,
            title: format!("Code search: {}", params.query),
            output: "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.".to_string(),
            metadata: json!({}),
            attachments: None,
        })
    }
}
