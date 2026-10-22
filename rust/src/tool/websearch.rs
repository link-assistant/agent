//! WebSearch tool implementation
//!
//! Performs web searches using the Exa MCP API,
//! matching the JavaScript implementation's websearch tool behavior.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::webfetch::read_body_bounded;
use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Anonymous Exa MCP endpoint, shared with the codesearch tool.
pub const EXA_MCP_URL: &str = "https://mcp.exa.ai/mcp";
const DEFAULT_NUM_RESULTS: u32 = 8;
const SEARCH_TIMEOUT_SECS: u64 = 25;
const MAX_RESPONSE_SIZE: usize = 5 * 1024 * 1024;

/// Tool description
const DESCRIPTION: &str = r#"Searches the web using the Exa search API.

Usage:
- Provide a natural language search query
- Optionally specify number of results (default: 8)
- Optionally specify live crawl mode ('fallback' or 'preferred')
- Optionally specify search type ('auto', 'fast', or 'deep')
- The current year is {{year}}. You MUST use this year when searching for recent information or current events
- Example: If the current year is {{year}} and the user asks for "latest AI news", search for "AI news {{year}}", not last year's news"#;

/// Tells the model the current year so "latest" searches are not pinned to
/// its training cutoff (upstream websearch.txt `{{year}}`).
fn description_with_year() -> &'static str {
    static DESCRIPTION_WITH_YEAR: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    DESCRIPTION_WITH_YEAR.get_or_init(|| {
        DESCRIPTION.replace("{{year}}", &chrono::Utc::now().format("%Y").to_string())
    })
}

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

/// Exa MCP endpoint. The anonymous endpoint is rate-limited; a non-empty
/// EXA_API_KEY lifts the limit (upstream fde3d9133b, #16362).
pub fn exa_mcp_url() -> String {
    exa_mcp_url_for(std::env::var("EXA_API_KEY").ok().as_deref())
}

/// [`exa_mcp_url`] for an explicit key.
pub fn exa_mcp_url_for(key: Option<&str>) -> String {
    match key.filter(|key| !key.is_empty()) {
        Some(key) => reqwest::Url::parse_with_params(EXA_MCP_URL, &[("exaApiKey", key)])
            .map(|url| url.to_string())
            .unwrap_or_else(|_| EXA_MCP_URL.to_string()),
        None => EXA_MCP_URL.to_string(),
    }
}

/// First text content of an Exa MCP reply, which is either SSE `data:`
/// lines or a plain JSON body.
pub fn parse_exa_response(text: &str) -> Option<String> {
    let first = |value: Value| {
        value["result"]["content"][0]["text"]
            .as_str()
            .map(str::to_string)
    };
    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data:") {
            if let Ok(value) = serde_json::from_str::<Value>(data.trim()) {
                if let Some(text) = first(value) {
                    return Some(text);
                }
            }
        }
    }
    serde_json::from_str::<Value>(text.trim())
        .ok()
        .and_then(first)
}

/// POST a JSON-RPC request to an Exa MCP endpoint. The client timeout also
/// covers the body, and the body is bounded (upstream 69f1ec22e3, #33259).
pub async fn call_exa(
    url: &str,
    request: &impl Serialize,
    timeout_secs: u64,
    tool: &str,
    label: &str,
) -> Result<Option<String>> {
    let client = reqwest::Client::builder()
        .timeout(tokio::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| AgentError::tool_execution(tool, e.to_string()))?;

    let response = client
        .post(url)
        .header("accept", "application/json, text/event-stream")
        .header("content-type", "application/json")
        .json(request)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                AgentError::tool_execution(tool, format!("{} request timed out", label))
            } else {
                AgentError::tool_execution(tool, e.to_string())
            }
        })?;

    let status = response.status();
    let body = read_body_bounded(response, MAX_RESPONSE_SIZE)
        .await
        .map_err(|e| AgentError::tool_execution(tool, format!("{} error: {}", label, e)))?;
    let text = String::from_utf8_lossy(&body);

    if !status.is_success() {
        return Err(AgentError::tool_execution(
            tool,
            format!("{} error ({}): {}", label, status, text),
        ));
    }

    Ok(parse_exa_response(&text))
}

/// WebSearch tool implementation
pub struct WebSearchTool;

#[async_trait]
impl Tool for WebSearchTool {
    fn id(&self) -> &'static str {
        "websearch"
    }

    fn description(&self) -> &'static str {
        description_with_year()
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

        let output = call_exa(
            &exa_mcp_url(),
            &search_request,
            SEARCH_TIMEOUT_SECS,
            "websearch",
            "Search",
        )
        .await?;

        if let Some(output) = output {
            return Ok(ToolResult {
                is_error: false,
                title: format!("Web search: {}", params.query),
                output,
                metadata: json!({}),
                attachments: None,
            });
        }

        Ok(ToolResult {
            is_error: false,
            title: format!("Web search: {}", params.query),
            output: "No search results found. Please try a different query.".to_string(),
            metadata: json!({}),
            attachments: None,
        })
    }
}
