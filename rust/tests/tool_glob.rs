//! Tests for the glob tool.
//!
//! Mirrors test coverage from js/tests/integration/glob.tools.test.js
//! and the original inline tests from rust/src/tool/glob.rs.

use link_assistant_agent::compat::ToolSettings;
use link_assistant_agent::tool::glob::GlobTool;
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};
use tempfile::TempDir;

fn create_context(dir: &Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
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
async fn test_glob_lists_absolute_paths_newest_first() {
    let temp = TempDir::new().unwrap();
    let old = temp.path().join("old.txt");
    let new = temp.path().join("new.txt");
    fs::write(&old, "x").unwrap();
    fs::write(&new, "x").unwrap();
    set_mtime(&old, 1_000_000);
    set_mtime(&new, 2_000_000);

    let ctx = create_context(temp.path());
    let result = GlobTool
        .execute(json!({ "pattern": "*.txt" }), &ctx)
        .await
        .unwrap();
    assert_eq!(
        result.output,
        format!("{}\n{}", new.display(), old.display())
    );
    assert_eq!(result.title, "");

    // Legacy output: relative paths, the pattern as title
    let result = GlobTool
        .execute(json!({ "pattern": "*.txt" }), &legacy_context(temp.path()))
        .await
        .unwrap();
    assert_eq!(result.output, "new.txt\nold.txt");
    assert_eq!(result.title, "*.txt");
}

#[tokio::test]
async fn test_glob_pattern_without_slash_matches_at_any_depth() {
    let temp = TempDir::new().unwrap();
    fs::create_dir_all(temp.path().join("src/deep")).unwrap();
    fs::write(temp.path().join("src/deep/a.ts"), "x").unwrap();
    fs::write(temp.path().join("top.ts"), "x").unwrap();

    let ctx = create_context(temp.path());
    let result = GlobTool
        .execute(json!({ "pattern": "*.ts" }), &ctx)
        .await
        .unwrap();
    assert_eq!(result.metadata["count"], 2, "{}", result.output);

    // A pattern with a slash is matched against the relative path
    let result = GlobTool
        .execute(json!({ "pattern": "src/**/*.ts" }), &ctx)
        .await
        .unwrap();
    assert_eq!(result.metadata["count"], 1, "{}", result.output);
    assert!(result.output.ends_with("a.ts"));

    // Legacy matching stays in the search directory
    let result = GlobTool
        .execute(json!({ "pattern": "*.ts" }), &legacy_context(temp.path()))
        .await
        .unwrap();
    assert_eq!(result.output, "top.ts");
}

#[tokio::test]
async fn test_glob_respects_gitignore_and_lists_hidden() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
    fs::write(temp.path().join(".git/config"), "x").unwrap();
    fs::write(temp.path().join(".gitignore"), "dist/\n").unwrap();
    fs::create_dir(temp.path().join("dist")).unwrap();
    fs::write(temp.path().join("dist/out.js"), "x").unwrap();
    fs::create_dir(temp.path().join(".github")).unwrap();
    fs::write(temp.path().join(".github/ci.yml"), "x").unwrap();
    fs::write(temp.path().join("kept.js"), "x").unwrap();

    let ctx = create_context(temp.path());
    let result = GlobTool
        .execute(json!({ "pattern": "*.js" }), &ctx)
        .await
        .unwrap();
    assert!(result.output.ends_with("kept.js"), "{}", result.output);
    assert!(!result.output.contains("out.js"), "{}", result.output);

    let result = GlobTool
        .execute(json!({ "pattern": "*.yml" }), &ctx)
        .await
        .unwrap();
    assert!(result.output.ends_with("ci.yml"), "{}", result.output);

    // As with rg, a glob that matches the ignored directory itself
    // overrides the ignore rule; `.git` stays skipped.
    let result = GlobTool
        .execute(json!({ "pattern": "**/*" }), &ctx)
        .await
        .unwrap();
    assert!(result.output.contains(".gitignore"), "{}", result.output);
    assert!(result.output.contains("out.js"), "{}", result.output);
    assert!(!result.output.contains("config"), "{}", result.output);
}

#[tokio::test]
async fn test_glob_path_errors() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("file.txt"), "x").unwrap();
    let ctx = create_context(temp.path());

    let err = GlobTool
        .execute(json!({ "pattern": "*", "path": "missing" }), &ctx)
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

    let err = GlobTool
        .execute(json!({ "pattern": "*", "path": "file.txt" }), &ctx)
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

    // Legacy output lists nothing for a missing path
    let result = GlobTool
        .execute(
            json!({ "pattern": "*", "path": "missing" }),
            &legacy_context(temp.path()),
        )
        .await
        .unwrap();
    assert_eq!(result.output, "");
}

#[tokio::test]
async fn test_glob_absolute_pattern_inside_search_directory() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join("sub")).unwrap();
    fs::write(temp.path().join("a.txt"), "x").unwrap();
    fs::write(temp.path().join("sub/b.txt"), "x").unwrap();

    let ctx = create_context(temp.path());
    let pattern = format!("{}/*.txt", temp.path().display());
    let result = GlobTool
        .execute(json!({ "pattern": pattern }), &ctx)
        .await
        .unwrap();
    assert_eq!(
        result.output,
        temp.path().join("a.txt").display().to_string()
    );
}

#[cfg(unix)]
#[tokio::test]
async fn test_glob_follow_symlinks_setting() {
    let temp = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::write(outside.path().join("linked.txt"), "x").unwrap();
    std::os::unix::fs::symlink(outside.path(), temp.path().join("link")).unwrap();

    let ctx = create_context(temp.path());
    let result = GlobTool
        .execute(json!({ "pattern": "**/*.txt" }), &ctx)
        .await
        .unwrap();
    assert_eq!(result.output, "No files found");

    let ctx = settings_context(
        temp.path(),
        ToolSettings {
            glob_follow_symlinks: true,
            ..ToolSettings::default()
        },
    );
    let result = GlobTool
        .execute(json!({ "pattern": "**/*.txt" }), &ctx)
        .await
        .unwrap();
    assert!(result.output.ends_with("linked.txt"), "{}", result.output);
}

#[tokio::test]
async fn test_glob_txt_files() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("file1.txt"), "content").unwrap();
    fs::write(temp.path().join("file2.txt"), "content").unwrap();
    fs::write(temp.path().join("file3.rs"), "content").unwrap();

    let tool = GlobTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "*.txt" });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("file1.txt"));
    assert!(result.output.contains("file2.txt"));
    assert!(!result.output.contains("file3.rs"));
}

#[tokio::test]
async fn test_glob_recursive() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join("subdir")).unwrap();
    fs::write(temp.path().join("root.txt"), "content").unwrap();
    fs::write(temp.path().join("subdir").join("nested.txt"), "content").unwrap();

    let tool = GlobTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "**/*.txt" });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("root.txt"));
    assert!(result.output.contains("nested.txt"));
}

#[tokio::test]
async fn test_glob_no_matches() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("file.txt"), "content").unwrap();

    let tool = GlobTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "*.rs" });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert_eq!(result.output, "No files found");
    assert_eq!(result.metadata["count"], 0);
    assert_eq!(result.metadata["truncated"], false);

    // Legacy output is empty
    let result = tool
        .execute(json!({ "pattern": "*.rs" }), &legacy_context(temp.path()))
        .await
        .unwrap();
    assert_eq!(result.output, "");
    assert_eq!(result.metadata["count"], 0);
}

// --- Additional tests matching JS glob tool coverage ---

#[tokio::test]
async fn test_glob_result_has_count_metadata() {
    // Mirrors JS test: glob result contains count metadata
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "content").unwrap();
    fs::write(temp.path().join("b.txt"), "content").unwrap();

    let tool = GlobTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "*.txt" });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert_eq!(result.metadata["count"], 2);
}

#[test]
fn test_glob_tool_id() {
    let tool = GlobTool;
    assert_eq!(tool.id(), "glob");
}

#[test]
fn test_glob_tool_parameters_schema() {
    let tool = GlobTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["pattern"].is_object());
}

// glob reliability fixes ported from upstream OpenCode (issue #335).

#[tokio::test]
async fn test_glob_results_are_limited_to_100() {
    let temp = TempDir::new().unwrap();
    for i in 0..150 {
        fs::write(temp.path().join(format!("file{}.txt", i)), "x").unwrap();
    }

    let tool = GlobTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "*.txt" });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert_eq!(result.metadata["count"], 100);
    assert_eq!(result.metadata["truncated"], true);
    assert!(result
        .output
        .contains("(Results are truncated. Consider using a more specific path or pattern.)"));
}

#[tokio::test]
async fn test_glob_small_result_is_not_truncated() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "x").unwrap();

    let tool = GlobTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "*.txt" });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert_eq!(result.metadata["count"], 1);
    assert_eq!(result.metadata["truncated"], false);
    assert!(!result.output.contains("truncated"));
}
