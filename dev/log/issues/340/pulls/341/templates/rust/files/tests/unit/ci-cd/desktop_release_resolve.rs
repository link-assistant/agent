#![cfg(not(windows))]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn unique_tmp(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "desktop-release-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos()
    ))
}

fn write_mock_gh(dir: &Path) {
    let mock = r#"#!/usr/bin/env bash
case "$1 $2" in
  "api repos/example/project/tags?per_page=100") exit 0 ;;
  "release view")
    if [[ " $* " == *" --json tagName "* ]] && [[ " $* " == *" --jq .tagName "* ]]; then
      printf 'v1.2.3\n'
    elif [[ " $* " == *" --json tagName "* ]]; then
      printf '{"tagName":"v1.2.3"}\n'
    elif [[ " $* " == *" --json assets "* ]]; then
      exit 0
    fi ;;
  "api repos/example/project/commits/v1.2.3") printf 'parent-sha\n' ;;
esac
"#;
    let path = dir.join("gh");
    fs::write(&path, mock).expect("write gh mock");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&path).expect("mock metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("make gh mock executable");
    }
}

#[test]
fn auto_release_child_commit_resolves_latest_release_and_builds() {
    let scratch = unique_tmp("child-release");
    let bin = scratch.join("bin");
    fs::create_dir_all(&bin).expect("create mock bin");
    write_mock_gh(&bin);
    let output_path = scratch.join("output");

    let output = Command::new("bash")
        .arg(format!(
            "{}/scripts/desktop-release-resolve.sh",
            env!("CARGO_MANIFEST_DIR")
        ))
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .env("EVENT", "workflow_run")
        .env("WORKFLOW_RUN_HEAD_SHA", "parent-sha")
        .env("REPO", "example/project")
        .env("GITHUB_OUTPUT", &output_path)
        .output()
        .expect("run resolver");

    let rendered = fs::read_to_string(&output_path).unwrap_or_default();
    let _ = fs::remove_dir_all(&scratch);
    assert!(
        output.status.success(),
        "resolver failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(rendered.contains("tag=v1.2.3"));
    assert!(rendered.contains("should_build=true"));
}
