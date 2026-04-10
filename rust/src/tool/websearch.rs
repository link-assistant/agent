//! WebSearch tool implementation
//!
//! Performs web searches using the Exa MCP API,
//! matching the JavaScript implementation's websearch tool behavior.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

const API_BASE_URL: &str = "https://mcp.exa.ai";
const API_ENDPOINT: &str = "/mcp";
const DEFAULT_NUM_RESULTS: u32 = 8;
const SEARCH_TIMEOUT_SECS: u64 = 25;

/// Tool description
const DESCRIPTION: &str = r#"Searches the web using the Exa search API.

Usage:
- Provide a natural language search query
- Optionally specify number of results (default: 8)
- Optionally specify live crawl mode ('fallback' or 'preferred')
- Optionally specify search type ('auto', 'fast', or 'deep')"#;

/// Parameters for the websearch tool
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchParams {
    /// The search query
    pub query: String,
    /// Number of search results to return
    #[serde(default)]
    pub num_results: Option<u32>,
    /// Live crawl mode
    #[serde(default)]
    pub livecrawl: Option<String>,
    /// Search type
    #[serde(rename = "type", default)]
    pub search_type: Option<String>,
    /// Maximum characters for context
    #[serde(default)]
    pub context_max_characters: Option<u32>,
}

#[derive(Debug, Serialize)]
struct McpSearchRequest {
    jsonrpc: String,
    id: u32,
    method: String,
    params: McpSearchParams,
}

#[derive(Debug, Serialize)]
struct McpSearchParams {
    name: String,
    arguments: McpSearchArguments,
}

#[derive(Debug, Serialize)]
struct McpSearchArguments {
    query: String,
    #[serde(rename = "type")]
    search_type: String,
    #[serde(rename = "numResults")]
    num_results: u32,
    livecrawl: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "contextMaxCharacters")]
    context_max_characters: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct McpSearchResponse {
    result: McpSearchResult,
}

#[derive(Debug, Deserialize)]
struct McpSearchResult {
    content: Vec<McpContent>,
}

#[derive(Debug, Deserialize)]
struct McpContent {
    #[serde(rename = "type")]
    #[allow(dead_code)]
    content_type: String,
    text: String,
}

/// WebSearch tool implementation
pub struct WebSearchTool;

#[async_trait]
impl Tool for WebSearchTool {
    fn id(&self) -> &'static str {
        "websearch"
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
                    "description": "Websearch query"
                },
                "numResults": {
                    "type": "number",
                    "description": "Number of search results to return (default: 8)"
                },
                "livecrawl": {
                    "type": "string",
                    "enum": ["fallback", "preferred"],
                    "description": "Live crawl mode - 'fallback': use live crawling as backup, 'preferred': prioritize live crawling"
                },
                "type": {
                    "type": "string",
                    "enum": ["auto", "fast", "deep"],
                    "description": "Search type - 'auto': balanced (default), 'fast': quick results, 'deep': comprehensive"
                },
                "contextMaxCharacters": {
                    "type": "number",
                    "description": "Maximum characters for context string (default: 10000)"
                }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, params: Value, _ctx: &ToolContext) -> Result<ToolResult> {
        let params: WebSearchParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("websearch", e.to_string()))?;

        let search_request = McpSearchRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "tools/call".to_string(),
            params: McpSearchParams {
                name: "web_search_exa".to_string(),
                arguments: McpSearchArguments {
                    query: params.query.clone(),
                    search_type: params.search_type.unwrap_or_else(|| "auto".to_string()),
                    num_results: params.num_results.unwrap_or(DEFAULT_NUM_RESULTS),
                    livecrawl: params.livecrawl.unwrap_or_else(|| "fallback".to_string()),
                    context_max_characters: params.context_max_characters,
                },
            },
        };

        let client = reqwest::Client::builder()
            .timeout(tokio::time::Duration::from_secs(SEARCH_TIMEOUT_SECS))
            .build()
            .map_err(|e| AgentError::tool_execution("websearch", e.to_string()))?;

        let response = client
            .post(format!("{}{}", API_BASE_URL, API_ENDPOINT))
            .header("accept", "application/json, text/event-stream")
            .header("content-type", "application/json")
            .json(&search_request)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AgentError::tool_execution("websearch", "Search request timed out")
                } else {
                    AgentError::tool_execution("websearch", e.to_string())
                }
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AgentError::tool_execution(
                "websearch",
                format!("Search error ({}): {}", status, error_text),
            ));
        }

        let response_text = response
            .text()
            .await
            .map_err(|e| AgentError::tool_execution("websearch", e.to_string()))?;

        // Parse SSE response (same as JS implementation)
        for line in response_text.lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(parsed) = serde_json::from_str::<McpSearchResponse>(data) {
                    if let Some(content) = parsed.result.content.first() {
                        return Ok(ToolResult {
                            title: format!("Web search: {}", params.query),
                            output: content.text.clone(),
                            metadata: json!({}),
                            attachments: None,
                        });
                    }
                }
            }
        }

        Ok(ToolResult {
            title: format!("Web search: {}", params.query),
            output: "No search results found. Please try a different query.".to_string(),
            metadata: json!({}),
            attachments: None,
        })
    }
}
