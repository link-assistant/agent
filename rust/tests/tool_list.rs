//! Tests for the list tool.
//!
//! Mirrors test coverage from js/tests/integration/list.tools.test.js
//! and the original inline tests from rust/src/tool/list.rs.

use link_assistant_agent::compat::ToolSettings;
use link_assistant_agent::tool::list::{should_ignore, ListTool};
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn create_context(dir: &Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_list_directory() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("file1.txt"), "content").unwrap();
    fs::write(temp.path().join("file2.txt"), "more content").unwrap();
    fs::create_dir(temp.path().join("subdir")).unwrap();
    fs::write(temp.path().join("subdir").join("nested.txt"), "nested").unwrap();

    let tool = ListTool;
    let ctx = create_context(temp.path());
    let params = json!({});

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("file1.txt"));
    assert!(result.output.contains("file2.txt"));
    assert!(result.output.contains("subdir"));
    assert!(result.output.contains("nested.txt"));
}

#[tokio::test]
async fn test_list_ignores_node_modules() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("app.js"), "code").unwrap();
    fs::create_dir(temp.path().join("node_modules")).unwrap();
    fs::write(temp.path().join("node_modules").join("pkg.js"), "package").unwrap();

    let tool = ListTool;
    let ctx = create_context(temp.path());
    let params = json!({});

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("app.js"));
    assert!(!result.output.contains("pkg.js"));
}

#[tokio::test]
async fn test_list_nonexistent() {
    let temp = TempDir::new().unwrap();

    let tool = ListTool;
    let ctx = create_context(temp.path());
    let params = json!({ "path": "/nonexistent/path" });

    let result = tool.execute(params, &ctx).await;
    assert!(result.is_err());
}

#[test]
fn test_should_ignore() {
    let patterns = vec![
        "node_modules".to_string(),
        ".git".to_string(),
        "dist".to_string(),
    ];
    assert!(should_ignore("node_modules", &patterns));
    assert!(should_ignore(".git", &patterns));
    assert!(should_ignore("dist", &patterns));
    assert!(!should_ignore("src", &patterns));
    assert!(!should_ignore("main.rs", &patterns));
}

// --- Additional tests matching JS list tool coverage ---

#[tokio::test]
async fn test_list_ignores_git_directory() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("app.rs"), "code").unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
    fs::write(temp.path().join(".git").join("config"), "git config").unwrap();

    let tool = ListTool;
    let ctx = create_context(temp.path());
    let params = json!({});

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("app.rs"));
    assert!(!result.output.contains("config"));
}

#[tokio::test]
async fn test_list_ignores_dist_directory() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("src.js"), "code").unwrap();
    fs::create_dir(temp.path().join("dist")).unwrap();
    fs::write(temp.path().join("dist").join("bundle.js"), "bundle").unwrap();

    let tool = ListTool;
    let ctx = create_context(temp.path());
    let params = json!({});

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("src.js"));
    assert!(!result.output.contains("bundle.js"));
}

#[test]
fn test_list_tool_id() {
    let tool = ListTool;
    assert_eq!(tool.id(), "list");
}

#[test]
fn test_list_tool_parameters_schema() {
    let tool = ListTool;
    let schema = tool.parameters_schema();
    // list tool should have path parameter
    assert!(schema["properties"]["path"].is_object());
}

fn legacy_context(dir: &Path) -> ToolContext {
    create_context(dir).with_settings(ToolSettings {
        legacy_tool_output: true,
        ..ToolSettings::default()
    })
}

fn touch(root: &Path, rel: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, "x").unwrap();
}

#[tokio::test]
async fn test_list_ignore_patterns_match_rg_globs() {
    // Same tree and result as
    // `rg --files --hidden --glob='!node_modules/*' --glob='!zig-out*' ...`
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    for rel in [
        "node_modules/pkg/i.js",
        "a/node_modules/n.js",
        "a/zig-out-x/z",
        "a/keep.md",
        "sub/dist/d.js",
        ".env",
        "top.log",
    ] {
        touch(root, rel);
    }

    let ctx = create_context(root);
    let result = ListTool
        .execute(json!({ "ignore": ["*.log"] }), &ctx)
        .await
        .unwrap();
    let expected = format!(
        "{}/\n  a/\n    node_modules/\n      n.js\n    keep.md\n  sub/\n    dist/\n      d.js\n  .env\n",
        root.display()
    );
    assert_eq!(result.output, expected);
    assert_eq!(result.metadata["count"], 4);
    assert_eq!(result.metadata["truncated"], false);
    assert_eq!(result.title, "");

    // Legacy output excludes the built-in names at any depth
    let result = ListTool
        .execute(json!({ "ignore": ["top.log"] }), &legacy_context(root))
        .await
        .unwrap();
    assert!(!result.output.contains("n.js"), "{}", result.output);
    assert!(!result.output.contains("d.js"), "{}", result.output);
    assert!(result.output.contains("zig-out-x"), "{}", result.output);
    assert_eq!(result.title, ".");
}

#[tokio::test]
async fn test_list_respects_gitignore() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    fs::create_dir(root.join(".git")).unwrap();
    fs::write(root.join(".gitignore"), "secret/\n").unwrap();
    touch(root, "secret/key.pem");
    touch(root, "src/main.rs");

    let result = ListTool
        .execute(json!({}), &create_context(root))
        .await
        .unwrap();
    assert!(result.output.contains("main.rs"), "{}", result.output);
    assert!(!result.output.contains("key.pem"), "{}", result.output);

    let result = ListTool
        .execute(json!({}), &legacy_context(root))
        .await
        .unwrap();
    assert!(result.output.contains("key.pem"), "{}", result.output);
}

#[tokio::test]
async fn test_list_limit_has_no_note() {
    let temp = TempDir::new().unwrap();
    for i in 0..120 {
        fs::write(temp.path().join(format!("f{:03}.txt", i)), "x").unwrap();
    }

    let result = ListTool
        .execute(json!({}), &create_context(temp.path()))
        .await
        .unwrap();
    assert_eq!(result.metadata["count"], 100);
    assert_eq!(result.metadata["truncated"], true);
    assert!(!result.output.contains("truncated"), "{}", result.output);
    assert!(result.output.contains("f099.txt"));
    assert!(!result.output.contains("f100.txt"));

    let result = ListTool
        .execute(json!({}), &legacy_context(temp.path()))
        .await
        .unwrap();
    assert!(result
        .output
        .contains("(Results are truncated. Consider using a more specific path or pattern.)"));
}

#[tokio::test]
async fn test_list_path_errors() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("file.txt"), "x").unwrap();
    let ctx = create_context(temp.path());

    let err = ListTool
        .execute(json!({ "path": "missing" }), &ctx)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains(&format!(
            "No such file or directory: '{}'",
            temp.path().join("missing").display()
        )),
        "{}",
        err
    );

    let err = ListTool
        .execute(json!({ "path": "file.txt" }), &ctx)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains(&format!(
            "Search path is not a directory: {}",
            temp.path().join("file.txt").display()
        )),
        "{}",
        err
    );

    let err = ListTool
        .execute(json!({ "path": "file.txt" }), &legacy_context(temp.path()))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("Not a directory"), "{}", err);
}
