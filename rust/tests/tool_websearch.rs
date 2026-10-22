//! Tests for the websearch tool.
//!
//! Mirrors test coverage from js/tests/integration/websearch.tools.test.js
//! and the original inline tests from rust/src/tool/websearch.rs.

use link_assistant_agent::tool::websearch::WebSearchTool;
use link_assistant_agent::tool::Tool;

#[test]
fn test_params_schema() {
    let tool = WebSearchTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["query"].is_object());
}

#[test]
fn test_websearch_tool_id() {
    let tool = WebSearchTool;
    assert_eq!(tool.id(), "websearch");
}

#[test]
fn test_websearch_tool_description() {
    let tool = WebSearchTool;
    assert!(!tool.description().is_empty());
}

// --- Issue #335: Exa MCP reliability (upstream fde3d9133b, 69f1ec22e3) ---

use link_assistant_agent::tool::websearch::{
    call_exa, exa_mcp_url_for, parse_exa_response, EXA_MCP_URL,
};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[test]
fn test_exa_url_without_key_is_anonymous() {
    assert_eq!(exa_mcp_url_for(None), EXA_MCP_URL);
    assert_eq!(exa_mcp_url_for(Some("")), EXA_MCP_URL);
}

#[test]
fn test_exa_url_with_key_is_encoded() {
    assert_eq!(
        exa_mcp_url_for(Some("a b&c")),
        "https://mcp.exa.ai/mcp?exaApiKey=a+b%26c"
    );
}

#[test]
fn test_exa_parses_sse_and_plain_json() {
    let body = r#"{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"hello"}]}}"#;
    assert_eq!(
        parse_exa_response(&format!("event: message\ndata: {}\n\n", body)).as_deref(),
        Some("hello")
    );
    assert_eq!(parse_exa_response(body).as_deref(), Some("hello"));
    assert_eq!(parse_exa_response("data: not json\n"), None);
}

#[test]
fn test_websearch_description_has_current_year() {
    let description = WebSearchTool.description();
    assert!(!description.contains("{{year}}"));
    assert!(description.contains(&chrono::Utc::now().format("%Y").to_string()));
}

/// Serves one response per connection: a JSON body for `/json`, an
/// unbounded chunked body for `/huge` and a 500 for `/fail`.
fn serve() -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let pulled = Arc::new(AtomicUsize::new(0));
    let counter = pulled.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let counter = counter.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
                match path.as_str() {
                    "/json" => {
                        let body = r#"{"result":{"content":[{"type":"text","text":"found"}]}}"#;
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                    }
                    "/fail" => {
                        let _ = write!(
                            stream,
                            "HTTP/1.1 500 Internal Server Error\r\ncontent-length: 4\r\nconnection: close\r\n\r\nboom"
                        );
                    }
                    _ => {
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n"
                        );
                        let chunk = vec![b'x'; 1024 * 1024];
                        for _ in 0..100 {
                            counter.fetch_add(1, Ordering::SeqCst);
                            if write!(stream, "{:x}\r\n", chunk.len()).is_err()
                                || stream.write_all(&chunk).is_err()
                                || stream.write_all(b"\r\n").is_err()
                            {
                                return;
                            }
                        }
                        let _ = stream.write_all(b"0\r\n\r\n");
                    }
                }
            });
        }
    });
    (format!("http://{}", addr), pulled)
}

#[tokio::test]
async fn test_exa_call_accepts_plain_json_reply() {
    let (base, _) = serve();
    let output = call_exa(
        &format!("{}/json", base),
        &serde_json::json!({}),
        5,
        "websearch",
        "Search",
    )
    .await
    .unwrap();
    assert_eq!(output.as_deref(), Some("found"));
}

#[tokio::test]
async fn test_exa_call_reports_http_errors_with_label() {
    let (base, _) = serve();
    let err = call_exa(
        &format!("{}/fail", base),
        &serde_json::json!({}),
        5,
        "codesearch",
        "Code search",
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(err.contains("Code search error (500"), "{}", err);
    assert!(err.contains("boom"), "{}", err);
}

#[tokio::test]
async fn test_exa_call_stops_reading_an_unbounded_body() {
    let (base, pulled) = serve();
    let err = call_exa(
        &format!("{}/huge", base),
        &serde_json::json!({}),
        20,
        "websearch",
        "Search",
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(err.contains("Search error: Response too large"), "{}", err);
    let pulled = pulled.load(Ordering::SeqCst);
    assert!(
        pulled < 40,
        "server wrote {} MB before the client gave up",
        pulled
    );
}
