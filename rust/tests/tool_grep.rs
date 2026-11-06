//! Tests for the grep tool.
//!
//! Mirrors test coverage from js/tests/integration/grep.tools.test.js
//! and the original inline tests from rust/src/tool/grep.rs.

use link_assistant_agent::compat::ToolSettings;
use link_assistant_agent::tool::grep::{matches_glob, GrepTool};
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};
use tempfile::TempDir;

fn create_context(dir: &Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_grep_simple() {
    let temp = TempDir::new().unwrap();
    fs::write(
        temp.path().join("test.txt"),
        "hello world\nfoo bar\nhello again",
    )
    .unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "hello",
        "output_mode": "content"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("hello world"));
    assert!(result.output.contains("hello again"));
    assert!(!result.output.contains("foo bar"));
}

#[tokio::test]
async fn test_grep_files_with_matches() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("match.txt"), "hello world").unwrap();
    fs::write(temp.path().join("no_match.txt"), "goodbye world").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "hello",
        "output_mode": "files_with_matches"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("match.txt"));
    assert!(!result.output.contains("no_match.txt"));
}

#[tokio::test]
async fn test_grep_case_insensitive() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("test.txt"), "Hello World\nHELLO WORLD").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "hello",
        "-i": true,
        "output_mode": "content"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("Hello World"));
    assert!(result.output.contains("HELLO WORLD"));
}

#[test]
fn test_glob_matching() {
    assert!(matches_glob("file.js", "*.js"));
    assert!(!matches_glob("file.ts", "*.js"));
    assert!(matches_glob("file.tsx", "**/*.tsx"));
}

// --- Additional tests matching JS grep tool coverage ---

#[tokio::test]
async fn test_grep_count_mode() {
    let temp = TempDir::new().unwrap();
    fs::write(
        temp.path().join("test.txt"),
        "hello world\nfoo bar\nhello again",
    )
    .unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "hello",
        "output_mode": "count"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    // Count mode should show match counts
    assert!(!result.output.is_empty());
}

#[tokio::test]
async fn test_grep_no_matches() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("test.txt"), "hello world").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "nonexistent_pattern_xyz",
        "output_mode": "content"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.is_empty());
}

#[tokio::test]
async fn test_grep_regex_pattern() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("test.txt"), "foo123\nbar456\nbaz").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "\\d+",
        "output_mode": "content"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("foo123"));
    assert!(result.output.contains("bar456"));
    assert!(!result.output.contains("baz"));
}

#[tokio::test]
async fn test_grep_long_matching_line_is_summarized_around_match() {
    let temp = TempDir::new().unwrap();
    fs::write(
        temp.path().join("long-match.txt"),
        format!(
            "{}ivu-modal-header{{cursor:move}}{}",
            "x".repeat(1500),
            "y".repeat(1500)
        ),
    )
    .unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "ivu-modal-header",
        "path": temp.path().to_string_lossy(),
        "glob": "*.txt",
        "output_mode": "content"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("ivu-modal-header{cursor:move}"));
    assert!(result.output.contains("[omitted columns 1..508 of line 1]"));
    assert!(result
        .output
        .contains("[omitted columns 2509..3029 of line 1]"));
    assert!(result.output.len() < 2300);
}

#[test]
fn test_grep_tool_id() {
    let tool = GrepTool;
    assert_eq!(tool.id(), "grep");
}

#[test]
fn test_grep_tool_parameters_schema() {
    let tool = GrepTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["pattern"].is_object());
}

// grep reliability fixes ported from upstream OpenCode (issue #335).

#[tokio::test]
async fn test_grep_searches_hidden_files() {
    // upstream #7501: `.github/` and other dotfiles are searched.
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join(".github")).unwrap();
    fs::write(temp.path().join(".github").join("ci.yml"), "needle: true\n").unwrap();
    fs::write(temp.path().join(".env.example"), "needle=1\n").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "needle" });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert!(result.output.contains("ci.yml"), "{}", result.output);
    assert!(result.output.contains(".env.example"), "{}", result.output);
}

#[tokio::test]
async fn test_grep_skips_git_directory() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
    fs::write(temp.path().join(".git").join("config"), "needle\n").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "needle" });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert!(!result.output.contains("config"), "{}", result.output);
}

fn settings_context(dir: &Path, settings: ToolSettings) -> ToolContext {
    create_context(dir).with_settings(settings)
}

fn legacy_context(dir: &Path) -> ToolContext {
    settings_context(
        dir,
        ToolSettings {
            legacy_tool_output: true,
            ..ToolSettings::default()
        },
    )
}

fn set_mtime(path: &Path, seconds: u64) {
    let file = fs::OpenOptions::new().write(true).open(path).unwrap();
    file.set_modified(UNIX_EPOCH + Duration::from_secs(seconds))
        .unwrap();
}

#[tokio::test]
async fn test_grep_default_output_matches_js() {
    let temp = TempDir::new().unwrap();
    let old = temp.path().join("old.txt");
    let new = temp.path().join("new.txt");
    fs::write(&old, "needle one\nother\n").unwrap();
    fs::write(&new, "x\nneedle two\r\nneedle three\n").unwrap();
    set_mtime(&old, 1_000_000);
    set_mtime(&new, 2_000_000);

    let ctx = create_context(temp.path());
    let result = GrepTool
        .execute(json!({ "pattern": "needle" }), &ctx)
        .await
        .unwrap();

    // Newest file first, absolute paths, JS line format, CR stripped
    let expected = format!(
        "Found 3 matches\n{}:\n  Line 2: needle two\n  Line 3: needle three\n\n{}:\n  Line 1: needle one",
        new.display(),
        old.display()
    );
    assert_eq!(result.output, expected);
    assert_eq!(result.metadata["matches"], 3);
    assert_eq!(result.metadata["truncated"], false);
    assert_eq!(result.title, "needle");
}

#[tokio::test]
async fn test_grep_no_files_found() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "nothing here\n").unwrap();

    let ctx = create_context(temp.path());
    let result = GrepTool
        .execute(json!({ "pattern": "needle" }), &ctx)
        .await
        .unwrap();
    assert_eq!(result.output, "No files found");
    assert_eq!(result.metadata["matches"], 0);
}

#[tokio::test]
async fn test_grep_truncates_at_100_matches() {
    let temp = TempDir::new().unwrap();
    let content: String = (0..150).map(|i| format!("needle {}\n", i)).collect();
    fs::write(temp.path().join("many.txt"), content).unwrap();

    let ctx = create_context(temp.path());
    let result = GrepTool
        .execute(json!({ "pattern": "needle" }), &ctx)
        .await
        .unwrap();
    assert!(result.output.starts_with("Found 100 matches\n"));
    assert!(result.output.contains("  Line 100: needle 99\n"));
    assert!(!result.output.contains("Line 101:"));
    assert!(result
        .output
        .ends_with("\n\n(Results are truncated. Consider using a more specific path or pattern.)"));
    assert_eq!(result.metadata["matches"], 100);
    assert_eq!(result.metadata["truncated"], true);

    // head_limit lowers the limit
    let result = GrepTool
        .execute(json!({ "pattern": "needle", "head_limit": 5 }), &ctx)
        .await
        .unwrap();
    assert!(result.output.starts_with("Found 5 matches\n"));
    assert_eq!(result.metadata["truncated"], true);
}

#[tokio::test]
async fn test_grep_include_filters_like_rg_glob() {
    let temp = TempDir::new().unwrap();
    fs::create_dir_all(temp.path().join("src/deep")).unwrap();
    fs::write(temp.path().join("src/deep/a.ts"), "needle\n").unwrap();
    fs::write(temp.path().join("src/b.tsx"), "needle\n").unwrap();
    fs::write(temp.path().join("c.js"), "needle\n").unwrap();

    let ctx = create_context(temp.path());
    let result = GrepTool
        .execute(
            json!({ "pattern": "needle", "include": "*.{ts,tsx}" }),
            &ctx,
        )
        .await
        .unwrap();
    assert!(result.output.contains("a.ts:"), "{}", result.output);
    assert!(result.output.contains("b.tsx:"), "{}", result.output);
    assert!(!result.output.contains("c.js"), "{}", result.output);

    // `glob` is the same filter
    let result = GrepTool
        .execute(json!({ "pattern": "needle", "glob": "*.js" }), &ctx)
        .await
        .unwrap();
    assert!(result.output.starts_with("Found 1 matches\n"));
    assert!(result.output.contains("c.js:"), "{}", result.output);
}

#[tokio::test]
async fn test_grep_respects_gitignore() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
    fs::write(temp.path().join(".gitignore"), "build/\n").unwrap();
    fs::create_dir(temp.path().join("build")).unwrap();
    fs::write(temp.path().join("build/out.txt"), "needle\n").unwrap();
    fs::write(temp.path().join("kept.txt"), "needle\n").unwrap();

    let ctx = create_context(temp.path());
    let result = GrepTool
        .execute(json!({ "pattern": "needle" }), &ctx)
        .await
        .unwrap();
    assert!(result.output.contains("kept.txt"), "{}", result.output);
    assert!(!result.output.contains("out.txt"), "{}", result.output);

    // Legacy output searches every file, as before
    let ctx = legacy_context(temp.path());
    let result = GrepTool
        .execute(json!({ "pattern": "needle" }), &ctx)
        .await
        .unwrap();
    assert!(result.output.contains("out.txt"), "{}", result.output);
}

#[tokio::test]
async fn test_grep_skips_binary_files() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("bin.dat"), b"needle\0\x01\x02").unwrap();
    fs::write(temp.path().join("text.txt"), "needle\n").unwrap();

    let ctx = create_context(temp.path());
    let result = GrepTool
        .execute(json!({ "pattern": "needle" }), &ctx)
        .await
        .unwrap();
    assert!(result.output.starts_with("Found 1 matches\n"));
    assert!(!result.output.contains("bin.dat"), "{}", result.output);
}

#[tokio::test]
async fn test_grep_missing_path_is_an_error() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path());
    let err = GrepTool
        .execute(json!({ "pattern": "x", "path": "missing" }), &ctx)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains(&format!(
            "Search path does not exist: {}",
            temp.path().join("missing").display()
        )),
        "{}",
        err
    );

    // Legacy output returns no matches
    let ctx = legacy_context(temp.path());
    let result = GrepTool
        .execute(json!({ "pattern": "x", "path": "missing" }), &ctx)
        .await
        .unwrap();
    assert_eq!(result.output, "");
}

#[tokio::test]
async fn test_grep_empty_pattern_is_an_error() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path());
    let err = GrepTool
        .execute(json!({ "pattern": "" }), &ctx)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("pattern is required"), "{}", err);
}

#[tokio::test]
async fn test_grep_invalid_regex_message() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path());
    let err = GrepTool
        .execute(json!({ "pattern": "(" }), &ctx)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("Invalid regex pattern"), "{}", err);
}

#[tokio::test]
async fn test_grep_legacy_default_is_files_with_matches() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("match.txt"), "needle\n").unwrap();
    fs::write(temp.path().join(".hidden.txt"), "needle\n").unwrap();

    let ctx = settings_context(temp.path(), ToolSettings::legacy());
    let result = GrepTool
        .execute(json!({ "pattern": "needle" }), &ctx)
        .await
        .unwrap();
    // Relative names, no header; legacy settings skip dotfiles
    assert_eq!(result.output, "match.txt");
    assert_eq!(result.metadata["count"], 1);
}

#[tokio::test]
async fn test_grep_hidden_setting() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join(".hidden.txt"), "needle\n").unwrap();

    let ctx = settings_context(
        temp.path(),
        ToolSettings {
            grep_hidden: false,
            ..ToolSettings::default()
        },
    );
    let result = GrepTool
        .execute(json!({ "pattern": "needle" }), &ctx)
        .await
        .unwrap();
    assert_eq!(result.output, "No files found");
}

#[tokio::test]
async fn test_grep_timeout_setting() {
    let temp = TempDir::new().unwrap();
    for i in 0..3000 {
        fs::write(temp.path().join(format!("f{}.txt", i)), "needle\n").unwrap();
    }

    let ctx = settings_context(
        temp.path(),
        ToolSettings {
            grep_timeout_ms: 1,
            ..ToolSettings::default()
        },
    );
    let err = GrepTool
        .execute(json!({ "pattern": "needle" }), &ctx)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains(
            "Search timed out after 0.001 seconds. Consider using a more specific path or pattern."
        ),
        "{}",
        err
    );

    // 0 removes the limit
    let ctx = settings_context(
        temp.path(),
        ToolSettings {
            grep_timeout_ms: 0,
            ..ToolSettings::default()
        },
    );
    let result = GrepTool
        .execute(json!({ "pattern": "needle" }), &ctx)
        .await
        .unwrap();
    assert_eq!(result.metadata["matches"], 100);
}

#[tokio::test]
async fn test_grep_explicit_file_path() {
    let temp = TempDir::new().unwrap();
    let file = temp.path().join("only.rs");
    fs::write(&file, "needle\n").unwrap();
    fs::write(temp.path().join("other.rs"), "needle\n").unwrap();

    let ctx = create_context(temp.path());
    let result = GrepTool
        .execute(
            json!({ "pattern": "needle", "path": "only.rs", "include": "*.txt" }),
            &ctx,
        )
        .await
        .unwrap();
    assert_eq!(
        result.output,
        format!("Found 1 matches\n{}:\n  Line 1: needle", file.display())
    );
}
