//! Tests for the webfetch tool.
//!
//! Mirrors test coverage from js/tests/integration/webfetch.tools.test.js
//! and the original inline tests from rust/src/tool/webfetch.rs.

use link_assistant_agent::tool::webfetch::{
    decode_html_entities, extract_text_from_html, strip_remaining_tags,
};

#[test]
fn test_extract_text_from_html() {
    let html = "<html><body><h1>Hello</h1><p>World</p><script>alert('x')</script></body></html>";
    let text = extract_text_from_html(html);
    assert!(text.contains("Hello"));
    assert!(text.contains("World"));
    assert!(!text.contains("alert"));
}

#[test]
fn test_html_entities() {
    let html = "Hello &amp; World &lt;tag&gt;";
    let decoded = decode_html_entities(html);
    assert_eq!(decoded, "Hello & World <tag>");
}

#[test]
fn test_strip_tags() {
    let html = "<p>Hello <b>World</b></p>";
    let stripped = strip_remaining_tags(html);
    assert_eq!(stripped, "Hello World");
}

// --- Additional tests matching JS webfetch tool coverage ---

#[test]
fn test_extract_text_strips_style_tags() {
    let html = "<html><head><style>body { color: red; }</style></head><body>Visible</body></html>";
    let text = extract_text_from_html(html);
    assert!(text.contains("Visible"));
    assert!(!text.contains("color"));
}

#[test]
fn test_decode_html_entities_all() {
    assert_eq!(decode_html_entities("&amp;"), "&");
    assert_eq!(decode_html_entities("&lt;"), "<");
    assert_eq!(decode_html_entities("&gt;"), ">");
    assert_eq!(decode_html_entities("&quot;"), "\"");
    assert_eq!(decode_html_entities("&#39;"), "'");
    assert_eq!(decode_html_entities("&nbsp;"), " ");
    assert_eq!(decode_html_entities("&apos;"), "'");
}

#[test]
fn test_strip_tags_nested() {
    let html = "<div><span><a href='#'>Link</a></span></div>";
    let stripped = strip_remaining_tags(html);
    assert_eq!(stripped, "Link");
}

#[test]
fn test_strip_tags_empty() {
    let html = "";
    let stripped = strip_remaining_tags(html);
    assert_eq!(stripped, "");
}

#[test]
fn test_extract_text_from_plain() {
    let text = extract_text_from_html("Just plain text");
    assert!(text.contains("Just plain text"));
}

use link_assistant_agent::tool::webfetch::WebFetchTool;
use link_assistant_agent::tool::Tool;

#[test]
fn test_webfetch_tool_id() {
    let tool = WebFetchTool;
    assert_eq!(tool.id(), "webfetch");
}

#[test]
fn test_webfetch_tool_parameters_schema() {
    let tool = WebFetchTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["url"].is_object());
}

// --- Issue #335: reliability fixes synced from upstream OpenCode ---

use link_assistant_agent::tool::ToolContext;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Requests the local server saw, and 1 MiB chunks it wrote for `/huge`.
#[derive(Default)]
struct Seen {
    user_agents: Mutex<Vec<String>>,
    pulled: AtomicUsize,
}

/// A minimal HTTP/1.1 server on 127.0.0.1; no real network is used.
async fn serve() -> (String, Arc<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Seen::default());
    let state = seen.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let seen = state.clone();
            tokio::spawn(async move {
                let mut request = Vec::new();
                let mut buf = [0u8; 1024];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match socket.read(&mut buf).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => request.extend_from_slice(&buf[..n]),
                    }
                }
                let request = String::from_utf8_lossy(&request).to_string();
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                let user_agent = request
                    .lines()
                    .find_map(|l| l.strip_prefix("user-agent: "))
                    .unwrap_or("")
                    .to_string();
                seen.user_agents.lock().unwrap().push(user_agent.clone());
                let reply = |status: &str, headers: &str, body: &str| {
                    format!(
                        "HTTP/1.1 {}\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                        status,
                        headers,
                        body.len(),
                        body
                    )
                };
                let response = match path.as_str() {
                    "/html" => reply(
                        "200 OK",
                        "Content-Type: text/html\r\n",
                        "<h1>Title</h1><p>Body</p>",
                    ),
                    "/cf" if user_agent.contains("Chrome") => reply(
                        "403 Forbidden",
                        "cf-mitigated: challenge\r\nContent-Type: text/html\r\n",
                        "challenge",
                    ),
                    "/cf" => reply("200 OK", "Content-Type: text/plain\r\n", "real page"),
                    "/forbidden" => reply("403 Forbidden", "", "no"),
                    "/huge" => {
                        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
                        if socket.write_all(head.as_bytes()).await.is_err() {
                            return;
                        }
                        let chunk = vec![b'x'; 1024 * 1024];
                        for _ in 0..100 {
                            seen.pulled.fetch_add(1, Ordering::SeqCst);
                            let size = format!("{:x}\r\n", chunk.len());
                            if socket.write_all(size.as_bytes()).await.is_err()
                                || socket.write_all(&chunk).await.is_err()
                                || socket.write_all(b"\r\n").await.is_err()
                            {
                                return;
                            }
                        }
                        let _ = socket.write_all(b"0\r\n\r\n").await;
                        return;
                    }
                    _ => reply("404 Not Found", "", "missing"),
                };
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            });
        }
    });
    (base, seen)
}

fn context() -> ToolContext {
    ToolContext::new("ses_test", "msg_test", std::env::temp_dir())
}

// Upstream fd973d242e (#6345): `format` is optional and defaults to markdown.
#[test]
fn test_webfetch_format_is_optional_in_schema() {
    let schema = WebFetchTool.parameters_schema();
    assert_eq!(schema["required"], json!(["url"]));
}

#[tokio::test]
async fn test_webfetch_without_format_returns_markdown() {
    let (base, _) = serve().await;
    let result = WebFetchTool
        .execute(json!({"url": format!("{}/html", base)}), &context())
        .await
        .unwrap();
    assert!(result.output.contains("# Title"), "{}", result.output);
    assert!(result.output.contains("Body"));
    assert!(!result.output.contains("<h1>"));
}

// Upstream b978ca11da (#10328) and 774c24e76e (#8284).
#[tokio::test]
async fn test_webfetch_retries_cloudflare_challenge_with_honest_user_agent() {
    let (base, seen) = serve().await;
    let result = WebFetchTool
        .execute(
            json!({"url": format!("{}/cf", base), "format": "text"}),
            &context(),
        )
        .await
        .unwrap();
    assert_eq!(result.output, "real page");
    let user_agents = seen.user_agents.lock().unwrap().clone();
    assert_eq!(user_agents.len(), 2);
    assert!(user_agents[0].contains("Chrome/143.0.0.0"));
    assert!(!user_agents[1].contains("Chrome"));
}

#[tokio::test]
async fn test_webfetch_plain_forbidden_is_not_retried() {
    let (base, seen) = serve().await;
    let error = WebFetchTool
        .execute(
            json!({"url": format!("{}/forbidden", base), "format": "text"}),
            &context(),
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("403"), "{}", error);
    assert_eq!(seen.user_agents.lock().unwrap().len(), 1);
}

// Upstream 69f1ec22e3 (#33259): stop reading a body once it is over 5 MB.
#[tokio::test]
async fn test_webfetch_stops_reading_an_unbounded_body() {
    let (base, seen) = serve().await;
    let error = WebFetchTool
        .execute(
            json!({"url": format!("{}/huge", base), "format": "text"}),
            &context(),
        )
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains("Response too large"),
        "{}",
        error
    );
    // Give the server a moment to notice the closed connection.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(seen.pulled.load(Ordering::SeqCst) < 40);
}
