//! Tests for the edit tool.
//!
//! Mirrors test coverage from js/tests/integration/edit.tools.test.js
//! and the original inline tests from rust/src/tool/edit.rs.

use link_assistant_agent::compat::ToolSettings;
use link_assistant_agent::tool::edit::{
    try_block_anchor_replace, try_context_aware_replace, try_escape_normalized_replace,
    try_exact_replace, try_indentation_flexible_replace, try_multi_occurrence_replace,
    try_trimmed_boundary_replace, EditTool,
};
use link_assistant_agent::tool::edit_match;
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn create_context(dir: &std::path::Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

// --- Tool execute tests ---

#[tokio::test]
async fn test_edit_exact_match() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "hello world").unwrap();

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "world",
        "newString": "rust"
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "hello rust");
}

#[tokio::test]
async fn test_edit_replace_all() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "foo bar foo baz foo").unwrap();

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "foo",
        "newString": "qux",
        "replaceAll": true
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "qux bar qux baz qux");
}

#[tokio::test]
async fn test_edit_same_string_error() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "hello").unwrap();

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "hello",
        "newString": "hello"
    });

    let result = tool.execute(params, &ctx).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_edit_create_new_file() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("new_file.txt");

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "",
        "newString": "new content"
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "new content");
}

// --- Replacement strategy unit tests ---

#[test]
fn test_exact_replace() {
    let content = "hello world";
    let result = try_exact_replace(content, "world", "rust", false);
    assert_eq!(result, Some("hello rust".to_string()));
}

#[test]
fn test_multiple_matches_without_replace_all() {
    let content = "foo bar foo";
    let result = try_exact_replace(content, "foo", "baz", false);
    assert_eq!(result, None);
}

#[test]
fn test_replace_all() {
    let content = "foo bar foo";
    let result = try_exact_replace(content, "foo", "baz", true);
    assert_eq!(result, Some("baz bar baz".to_string()));
}

#[test]
fn test_indentation_flexible() {
    let content = "    fn hello() {\n        println!(\"hi\");\n    }";
    let old = "fn hello() {\n    println!(\"hi\");\n}";
    let result = try_indentation_flexible_replace(content, old, "fn world() {}", false);
    assert!(result.is_some());
}

#[test]
fn test_escape_normalized() {
    let content = "let msg = \"hello\\nworld\";";
    let result = try_escape_normalized_replace(content, "hello", "goodbye", false);
    assert!(result.is_some());
}

#[test]
fn test_trimmed_boundary() {
    let content = "  hello world  ";
    let old = "  hello world  ";
    let _result = try_trimmed_boundary_replace(content, old, "goodbye", false);
    let old2 = "  hello world  \n  ";
    let _result2 = try_trimmed_boundary_replace(content, old2, "goodbye", false);
    // Just ensure no panic
}

#[test]
fn test_context_aware() {
    let content = "fn foo() {\n    let x = 1;\n    x + 1\n}";
    let old = "fn foo() {\n    let x = 1;\n    x + 1\n}";
    let result = try_context_aware_replace(content, old, "fn bar() {}", false);
    assert!(result.is_some());
}

#[test]
fn test_multi_occurrence_replace() {
    let content = "foo bar foo baz foo";
    let result = try_multi_occurrence_replace(content, "foo", "qux");
    assert_eq!(result, Some("qux bar qux baz qux".to_string()));
}

// --- Additional tests matching JS edit tool behavior ---

#[tokio::test]
async fn test_edit_result_has_metadata() {
    // Mirrors JS test: edit result contains diff metadata (diagnostics, diff, filediff)
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "Hello World\n").unwrap();

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "Hello",
        "newString": "Hi"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    // Validate metadata has required fields matching JS output
    assert!(result.metadata.get("diagnostics").is_some());
    assert!(result.metadata.get("diff").is_some());
    assert!(result.metadata.get("filediff").is_some());

    // Validate filediff structure
    let filediff = &result.metadata["filediff"];
    assert!(filediff.get("file").is_some());
    assert!(filediff.get("before").is_some());
    assert!(filediff.get("after").is_some());
    assert!(filediff.get("additions").is_some());
    assert!(filediff.get("deletions").is_some());

    // Verify file was actually edited
    let content = fs::read_to_string(&file_path).unwrap();
    assert!(content.contains("Hi World"));
}

#[tokio::test]
async fn test_edit_nonexistent_file_with_old_string_errors() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("nonexistent.txt");

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "something",
        "newString": "else"
    });

    let result = tool.execute(params, &ctx).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_edit_preserves_line_endings() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "line1\nline2\nline3\n").unwrap();

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "line2",
        "newString": "replaced"
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "line1\nreplaced\nline3\n");
}

#[test]
fn test_edit_tool_id() {
    let tool = EditTool;
    assert_eq!(tool.id(), "edit");
}

#[test]
fn test_edit_tool_parameters_schema() {
    let tool = EditTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["filePath"].is_object());
    assert!(schema["properties"]["oldString"].is_object());
    assert!(schema["properties"]["newString"].is_object());
}

// --- Reliability fixes synced from upstream OpenCode (issue #335) ---

#[tokio::test]
async fn test_edit_keeps_crlf_line_endings() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("crlf.txt");
    fs::write(&file_path, "a\r\nb\r\nc\r\n").unwrap();

    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "a\nb",
        "newString": "a\nB\nb2"
    });
    EditTool.execute(params, &ctx).await.unwrap();

    // Before the fix the whole file was rewritten with LF line endings.
    assert_eq!(
        fs::read_to_string(&file_path).unwrap(),
        "a\r\nB\r\nb2\r\nc\r\n"
    );
}

#[tokio::test]
async fn test_edit_keeps_utf8_bom() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("bom.txt");
    fs::write(&file_path, "\u{feff}hello world\n").unwrap();

    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "hello",
        "newString": "goodbye"
    });
    EditTool.execute(params, &ctx).await.unwrap();

    assert_eq!(fs::read(&file_path).unwrap()[..3], [0xef, 0xbb, 0xbf]);
    assert_eq!(
        fs::read_to_string(&file_path).unwrap(),
        "\u{feff}goodbye world\n"
    );
}

#[tokio::test]
async fn test_edit_empty_old_string_does_not_overwrite_existing_file() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("keep.txt");
    fs::write(&file_path, "precious\n").unwrap();

    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "",
        "newString": "gone"
    });
    let err = EditTool.execute(params, &ctx).await.unwrap_err();

    assert!(err.to_string().contains("oldString cannot be empty"));
    assert_eq!(fs::read_to_string(&file_path).unwrap(), "precious\n");
}

#[tokio::test]
async fn test_edit_returns_confirmation_output() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("ok.txt");
    fs::write(&file_path, "alpha\n").unwrap();

    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "alpha",
        "newString": "beta"
    });
    let result = EditTool.execute(params, &ctx).await.unwrap();
    assert_eq!(result.output, "Edit applied successfully.");
}

#[test]
fn test_block_anchor_rejects_unrelated_middle() {
    let content = "start\nalpha beta gamma\nend";
    let old = "start\nzzzzzzzzzzzzzzzz\nend";
    assert!(try_block_anchor_replace(content, old, "x", false).is_none());
}

#[test]
fn test_block_anchor_rejects_much_larger_block() {
    let content =
        "fn a() {\n  one();\n  two();\n  three();\n  four();\n  five();\n  six();\n  seven();\n}";
    let old = "fn a() {\n  totally different\n}";
    assert!(try_block_anchor_replace(content, old, "x", false).is_none());
}

#[test]
fn test_block_anchor_accepts_close_middle() {
    let content = "start\n  value = compute(1, 2);\nend";
    let old = "start\n  value = compute(1, 3);\nend";
    assert_eq!(
        try_block_anchor_replace(content, old, "replaced", false).as_deref(),
        Some("replaced")
    );
}

#[tokio::test]
async fn test_edit_mixed_line_endings_keep_untouched_lines() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("mixed.txt");
    // Mostly LF with one stray CRLF line (upstream OpenCode #53166).
    fs::write(&file_path, "a\nb\nc\r\nd\ne\n").unwrap();

    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "d\ne",
        "newString": "d\nd2\ne"
    });
    EditTool.execute(params, &ctx).await.unwrap();

    // Before the fix every line became CRLF because the file contained one.
    assert_eq!(
        fs::read_to_string(&file_path).unwrap(),
        "a\nb\nc\r\nd\nd2\ne\n"
    );
}

#[tokio::test]
async fn test_edit_crlf_file_with_fuzzy_match() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("crlf-fuzzy.txt");
    fs::write(&file_path, "fn a() {\r\n    one();\r\n}\r\n").unwrap();

    let ctx = create_context(temp.path());
    // Indentation differs, so only the whitespace-tolerant replacers match.
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "fn a() {\n  one();\n}",
        "newString": "fn a() {\n    two();\n}"
    });
    EditTool.execute(params, &ctx).await.unwrap();

    assert_eq!(
        fs::read_to_string(&file_path).unwrap(),
        "fn a() {\r\n    two();\r\n}\r\n"
    );
}

#[tokio::test]
async fn test_edit_mostly_crlf_file_keeps_stray_lf_line() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("mostly-crlf.txt");
    fs::write(&file_path, "a\r\nb\nc\r\nd\r\n").unwrap();

    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "c\nd",
        "newString": "c\nc2\nd"
    });
    EditTool.execute(params, &ctx).await.unwrap();

    assert_eq!(
        fs::read_to_string(&file_path).unwrap(),
        "a\r\nb\nc\r\nc2\r\nd\r\n"
    );
}

// --- JS edit parity (issue #335) ---

fn settings_context(dir: &Path, settings: ToolSettings) -> ToolContext {
    create_context(dir).with_settings(settings)
}

fn legacy_output_context(dir: &Path) -> ToolContext {
    settings_context(
        dir,
        ToolSettings {
            legacy_tool_output: true,
            ..ToolSettings::default()
        },
    )
}

fn legacy_matching_context(dir: &Path) -> ToolContext {
    settings_context(
        dir,
        ToolSettings {
            legacy_edit_matching: true,
            ..ToolSettings::default()
        },
    )
}

const MULTIPLE: &str = "err:Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match.";
const NOT_FOUND: &str = "err:oldString not found in content";

#[test]
fn test_replace_matches_js_reference() {
    // Expected values produced by the JS `replace` of js/src/tool/edit.ts
    let wide = format!("a\n{}b\n", " ".repeat(600));
    let cases: Vec<(&str, &str, &str, &str, bool, &str)> = vec![
        (
            "block anchor picks the most similar block",
            "fn a() {\n  one();\n  two();\n}\nfn a() {\n  uno();\n  dos();\n}\n",
            "fn a() {\n  uno();\n  dos2();\n}",
            "X",
            false,
            "ok:fn a() {\n  one();\n  two();\n}\nX\n",
        ),
        (
            "block anchor below the threshold",
            "start\n  alpha\n  beta\nend\n",
            "start\n  zzzzz\n  qqqqq\nend",
            "X",
            false,
            NOT_FOUND,
        ),
        (
            "disproportionate fuzzy match",
            &wide,
            "a\nb",
            "X",
            false,
            "err:Refusing replacement because the matched span is much larger than oldString. Re-read the file and provide the full exact oldString for the intended replacement.",
        ),
        (
            "whitespace-normalized part of a line",
            "let  x =   1; // keep\n",
            "x = 1;",
            "y = 2;",
            false,
            "ok:let  y = 2; // keep\n",
        ),
        (
            "escape-normalized",
            "say(\"hi\\n\");\n",
            "say(\"hi\\\\n\");",
            "say(\"yo\");",
            false,
            "ok:say(\"yo\");\n",
        ),
        (
            "trimmed boundary",
            "foo\nbar\nbaz\n",
            "\n  bar  \n",
            "BAR",
            false,
            "ok:foo\nBAR\nbaz\n",
        ),
        (
            "context aware",
            "if (a) {\n  b();\n  c();\n  d();\n}\n",
            "if (a) {\n  b();\n  X();\n  d();\n}",
            "Y",
            false,
            "ok:Y\n",
        ),
        ("exact match twice", "x\nx\n", "x", "y", false, MULTIPLE),
        ("fuzzy match twice", "  x\n  x\n", " x ", "y", false, MULTIPLE),
        ("replaceAll is literal", "a a", "a", "$&b", true, "ok:$&b $&b"),
        ("JS trim removes NBSP", "\u{a0}value\n", "value ", "v", false, "ok:v\n"),
        ("JS trim removes BOM", "x\n\u{feff}key = 1\n", " key = 1", "k", false, "ok:x\nk\n"),
        ("not found", "abc", "zzz", "y", false, NOT_FOUND),
        (
            "indentation flexible",
            "    if x:\n        y()\n",
            "if x:\n    y()",
            "pass",
            false,
            "ok:pass\n",
        ),
        ("two-line anchors", "a\nmid\nb\n", "a\nb\n", "Z", false, "ok:Z\n"),
    ];
    for (name, content, old, new, all, expected) in cases {
        let actual = match edit_match::replace(content, old, new, all) {
            Ok(text) => format!("ok:{}", text),
            Err(e) => format!("err:{}", e),
        };
        assert_eq!(actual, expected, "{}", name);
    }
}

#[test]
fn test_trim_diff_matches_js() {
    assert_eq!(
        edit_match::trim_diff(
            "Index: f\n===\n--- f\n+++ f\n@@ -1,2 +1,2 @@\n     a\n-    b\n+      c\n \n"
        ),
        "Index: f\n===\n--- f\n+++ f\n@@ -1,2 +1,2 @@\n a\n-b\n+  c\n \n"
    );
}

#[test]
fn test_two_files_patch_matches_jsdiff() {
    // Expected values produced by `createTwoFilesPatch` of the `diff` package
    let header = "Index: /p/f.txt\n===================================================================\n--- /p/f.txt\n+++ /p/f.txt\n";
    let cases = [
        ("a\nb\nc\n", "a\nB\nc\n", "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n"),
        (
            "a\nb\nc",
            "a\nb\nC",
            "@@ -1,3 +1,3 @@\n a\n b\n-c\n\\ No newline at end of file\n+C\n\\ No newline at end of file\n",
        ),
        ("", "new\nfile\n", "@@ -0,0 +1,2 @@\n+new\n+file\n"),
        ("", "x", "@@ -0,0 +1,1 @@\n+x\n\\ No newline at end of file\n"),
        (
            "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n",
            "1\nX\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\nY\n15\n",
            "@@ -1,6 +1,6 @@\n 1\n-2\n+X\n 3\n 4\n 5\n 6\n@@ -10,6 +10,6 @@\n 10\n 11\n 12\n 13\n-14\n+Y\n 15\n",
        ),
        (
            "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n",
            "1\nX\n3\n4\n5\n6\n7\n8\n9\n10\nY\n12\n13\n",
            "@@ -1,13 +1,13 @@\n 1\n-2\n+X\n 3\n 4\n 5\n 6\n 7\n 8\n 9\n 10\n-11\n+Y\n 12\n 13\n",
        ),
        ("only\n", "", "@@ -1,1 +0,0 @@\n-only\n"),
        ("a\nb\n", "a\nb\nc\n", "@@ -1,2 +1,3 @@\n a\n b\n+c\n"),
    ];
    for (old, new, hunks) in cases {
        assert_eq!(
            edit_match::two_files_patch("/p/f.txt", old, new),
            format!("{}{}", header, hunks)
        );
    }
    assert_eq!(
        edit_match::count_changes(
            "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n",
            "1\nX\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\nY\n15\n"
        ),
        (2, 2)
    );
}

#[tokio::test]
async fn test_edit_diff_and_filediff_match_js() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("crlf.txt");
    fs::write(&file_path, "a\r\n    b\r\nc\r\n").unwrap();
    let path = file_path.to_string_lossy().to_string();
    let params = json!({ "filePath": path, "oldString": "    b", "newString": "    B" });

    let result = EditTool
        .execute(params.clone(), &create_context(temp.path()))
        .await
        .unwrap();
    assert_eq!(
        result.metadata["diff"],
        format!(
            "Index: {path}\n===================================================================\n--- {path}\n+++ {path}\n@@ -1,3 +1,3 @@\n a\n-    b\n+    B\n c\n"
        )
    );
    // filediff keeps the file's own line endings
    assert_eq!(result.metadata["filediff"]["before"], "a\r\n    b\r\nc\r\n");
    assert_eq!(result.metadata["filediff"]["after"], "a\r\n    B\r\nc\r\n");
    assert_eq!(result.metadata["filediff"]["additions"], 1);
    assert_eq!(result.metadata["filediff"]["deletions"], 1);

    // Legacy output: the earlier diff and the LF view
    fs::write(&file_path, "a\r\n    b\r\nc\r\n").unwrap();
    let result = EditTool
        .execute(params, &legacy_output_context(temp.path()))
        .await
        .unwrap();
    assert_eq!(
        result.metadata["diff"],
        format!("--- {path}\n+++ {path}\n a\n-    b\n+    B\n c\n")
    );
    assert_eq!(result.metadata["filediff"]["before"], "a\n    b\nc\n");
}

#[tokio::test]
async fn test_edit_new_file_diff_matches_js() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("new.txt");
    let path = file_path.to_string_lossy().to_string();
    let result = EditTool
        .execute(
            json!({ "filePath": path, "oldString": "", "newString": "\u{feff}  x\n  y\n" }),
            &create_context(temp.path()),
        )
        .await
        .unwrap();
    // The BOM is written once and kept out of the diff; the common
    // indentation is removed from the diff (JS trimDiff).
    assert_eq!(
        fs::read_to_string(&file_path).unwrap(),
        "\u{feff}  x\n  y\n"
    );
    assert_eq!(
        result.metadata["diff"],
        format!(
            "Index: {path}\n===================================================================\n--- {path}\n+++ {path}\n@@ -0,0 +1,2 @@\n+x\n+y\n"
        )
    );
    assert_eq!(result.metadata["filediff"]["after"], "  x\n  y\n");
    assert_eq!(result.metadata["filediff"]["additions"], 2);
}

#[tokio::test]
async fn test_edit_missing_file_and_directory_errors() {
    let temp = TempDir::new().unwrap();
    let missing = temp.path().join("missing.txt");
    let params =
        json!({ "filePath": missing.to_string_lossy(), "oldString": "a", "newString": "b" });

    let err = EditTool
        .execute(params.clone(), &create_context(temp.path()))
        .await
        .unwrap_err();
    assert!(
        err.to_string()
            .contains(&format!("File {} not found", missing.display())),
        "{}",
        err
    );

    let err = EditTool
        .execute(params, &legacy_output_context(temp.path()))
        .await
        .unwrap_err();
    assert!(
        !err.to_string()
            .contains(&format!("File {} not found", missing.display())),
        "{}",
        err
    );

    let params =
        json!({ "filePath": temp.path().to_string_lossy(), "oldString": "a", "newString": "b" });
    let err = EditTool
        .execute(params, &create_context(temp.path()))
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains(&format!(
            "Path is a directory, not a file: {}",
            temp.path().display()
        )),
        "{}",
        err
    );

    let err = EditTool
        .execute(
            json!({ "filePath": "", "oldString": "a", "newString": "b" }),
            &create_context(temp.path()),
        )
        .await
        .unwrap_err();
    assert!(err.to_string().contains("filePath is required"), "{}", err);
}

#[tokio::test]
async fn test_edit_refuses_disproportionate_fuzzy_match() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("wide.txt");
    let original = format!("a\n{}b\n", " ".repeat(600));
    fs::write(&file_path, &original).unwrap();
    let params =
        json!({ "filePath": file_path.to_string_lossy(), "oldString": "a\nb", "newString": "X" });

    let err = EditTool
        .execute(params.clone(), &create_context(temp.path()))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("Refusing replacement"), "{}", err);
    assert_eq!(fs::read_to_string(&file_path).unwrap(), original);

    // Legacy matching replaced the line-trimmed match
    EditTool
        .execute(params, &legacy_matching_context(temp.path()))
        .await
        .unwrap();
    assert_eq!(fs::read_to_string(&file_path).unwrap(), "X\n");
}

#[tokio::test]
async fn test_edit_matches_first_line_after_bom() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("bom.txt");
    fs::write(&file_path, "\u{feff}  key = 1\n  other = 2\n").unwrap();
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "key = 1\nother = 2",
        "newString": "key = 3\nother = 4"
    });

    let result = EditTool
        .execute(params.clone(), &create_context(temp.path()))
        .await
        .unwrap();
    assert_eq!(
        fs::read_to_string(&file_path).unwrap(),
        "\u{feff}key = 3\nother = 4\n"
    );
    assert_eq!(
        result.metadata["filediff"]["before"],
        "  key = 1\n  other = 2\n"
    );

    // The earlier matching kept the BOM in the first line
    fs::write(&file_path, "\u{feff}  key = 1\n  other = 2\n").unwrap();
    let err = EditTool
        .execute(params, &legacy_matching_context(temp.path()))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("not found"), "{}", err);
}
