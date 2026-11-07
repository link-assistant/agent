use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::rust_paths::{
    get_cargo_lock_path, get_cargo_toml_path, get_changelog_dir, get_changelog_path,
    get_package_manifest_path, get_rust_root, needs_cd, parse_rust_root_from_args,
    read_package_info,
};

fn temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("rust-paths-{name}-{nanos}"));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn resolves_root_package_manifest_when_package_exists() {
    let repo = temp_dir("root-package");
    fs::write(
        repo.join("Cargo.toml"),
        r#"[package]
name = "root-crate"
version = "1.2.3"
"#,
    )
    .unwrap();

    let manifest = get_package_manifest_path(&repo.join("Cargo.toml")).unwrap();
    let info = read_package_info(&manifest).unwrap();

    assert_eq!(manifest, repo.join("Cargo.toml"));
    assert_eq!(info.name, "root-crate");
    assert_eq!(info.version, "1.2.3");
}

#[test]
fn resolves_first_publishable_workspace_member() {
    let repo = temp_dir("workspace-member");
    fs::create_dir_all(repo.join("private-crate")).unwrap();
    fs::create_dir_all(repo.join("public-crate")).unwrap();

    fs::write(
        repo.join("Cargo.toml"),
        r#"[workspace]
members = ["private-crate", "public-crate"]
resolver = "2"
"#,
    )
    .unwrap();

    fs::write(
        repo.join("private-crate/Cargo.toml"),
        r#"[package]
name = "private-crate"
version = "0.1.0"
publish = false
"#,
    )
    .unwrap();

    fs::write(
        repo.join("public-crate/Cargo.toml"),
        r#"[package]
name = "public-crate"
version = "0.2.0"
"#,
    )
    .unwrap();

    let manifest = get_package_manifest_path(&repo.join("Cargo.toml")).unwrap();
    let info = read_package_info(&manifest).unwrap();

    assert_eq!(manifest, repo.join("public-crate/Cargo.toml"));
    assert_eq!(info.name, "public-crate");
    assert_eq!(info.version, "0.2.0");
}

#[test]
fn errors_when_workspace_has_no_publishable_members() {
    let repo = temp_dir("no-publishable-members");
    fs::create_dir_all(repo.join("private-crate")).unwrap();

    fs::write(
        repo.join("Cargo.toml"),
        r#"[workspace]
members = ["private-crate"]
"#,
    )
    .unwrap();

    fs::write(
        repo.join("private-crate/Cargo.toml"),
        r#"[package]
name = "private-crate"
version = "0.1.0"
publish = false
"#,
    )
    .unwrap();

    let error = get_package_manifest_path(&repo.join("Cargo.toml")).unwrap_err();
    assert!(error.contains("No publishable workspace members"));
}

// --- issue #155: manifest values must be read from the right table ----------
//
// `version = "1.0"` under `[dependencies.serde]` is serde's version. A
// table-blind first-match regex publishes it as the crate's version whenever
// the real `[package].version` is missing or inherited from the workspace.

#[test]
fn an_inherited_version_fails_loudly_instead_of_publishing_a_dependency_version() {
    let repo = temp_dir("inherited-version");
    fs::create_dir_all(&repo).unwrap();
    let manifest = repo.join("Cargo.toml");
    fs::write(
        &manifest,
        r#"[package]
name = "member"
version.workspace = true

[dependencies.serde]
version = "1.0"
features = ["derive"]
"#,
    )
    .unwrap();

    let error = read_package_info(&manifest).unwrap_err();

    assert!(
        error.contains("inherited from the workspace"),
        "an inherited version must be rejected loudly, got: {error}"
    );
    assert!(
        !error.contains("1.0"),
        "the error must not echo the dependency's version, got: {error}"
    );
}

#[test]
fn the_inline_table_form_of_an_inherited_version_is_rejected_too() {
    let repo = temp_dir("inherited-version-inline");
    fs::create_dir_all(&repo).unwrap();
    let manifest = repo.join("Cargo.toml");
    fs::write(
        &manifest,
        r#"[package]
name = "member"
version = { workspace = true }
"#,
    )
    .unwrap();

    let error = read_package_info(&manifest).unwrap_err();
    assert!(
        error.contains("inherited from the workspace"),
        "got: {error}"
    );
}

#[test]
fn a_workspace_package_table_before_the_package_table_does_not_win() {
    let repo = temp_dir("workspace-package-first");
    fs::create_dir_all(&repo).unwrap();
    let manifest = repo.join("Cargo.toml");
    fs::write(
        &manifest,
        r#"[workspace.package]
version = "9.9.9"

[package]
name = "crate"
version = "1.2.3"
"#,
    )
    .unwrap();

    let info = read_package_info(&manifest).unwrap();
    assert_eq!(info.version, "1.2.3", "the [package] version must win");
}

#[test]
fn a_dependency_table_version_is_never_read_as_the_package_version() {
    let repo = temp_dir("dependency-table");
    fs::create_dir_all(&repo).unwrap();
    let manifest = repo.join("Cargo.toml");
    fs::write(
        &manifest,
        r#"[package]
name = "crate"
version = "2.0.0"

[dependencies.serde]
version = "0.5.0"
"#,
    )
    .unwrap();

    let info = read_package_info(&manifest).unwrap();
    assert_eq!(info.version, "2.0.0");
    assert_eq!(info.name, "crate");
}

#[test]
fn a_name_from_another_table_is_never_read_as_the_package_name() {
    let repo = temp_dir("foreign-name");
    fs::create_dir_all(&repo).unwrap();
    let manifest = repo.join("Cargo.toml");
    fs::write(
        &manifest,
        r#"[metadata]
name = "wrong"

[package]
name = "right"
version = "1.0.0"
"#,
    )
    .unwrap();

    let info = read_package_info(&manifest).unwrap();
    assert_eq!(info.name, "right");
}

#[test]
fn a_missing_package_version_fails_instead_of_guessing() {
    let repo = temp_dir("missing-version");
    fs::create_dir_all(&repo).unwrap();
    let manifest = repo.join("Cargo.toml");
    fs::write(
        &manifest,
        r#"[package]
name = "crate"

[dependencies]
serde = "1.0"
"#,
    )
    .unwrap();

    let error = read_package_info(&manifest).unwrap_err();
    assert!(
        error.contains("literal `version`"),
        "a missing version must be an error, not a dependency version, got: {error}"
    );
}

#[test]
fn path_helpers_match_repository_layout() {
    assert_eq!(get_cargo_toml_path("."), PathBuf::from("./Cargo.toml"));
    assert_eq!(get_cargo_lock_path("."), PathBuf::from("./Cargo.lock"));
    assert_eq!(get_changelog_dir("."), PathBuf::from("./changelog.d"));
    assert_eq!(get_changelog_path("."), PathBuf::from("./CHANGELOG.md"));
    assert!(!needs_cd("."));

    assert_eq!(
        get_cargo_toml_path("rust"),
        PathBuf::from("rust/Cargo.toml")
    );
    assert_eq!(
        get_cargo_lock_path("rust"),
        PathBuf::from("rust/Cargo.lock")
    );
    assert_eq!(get_changelog_dir("rust"), PathBuf::from("rust/changelog.d"));
    assert_eq!(
        get_changelog_path("rust"),
        PathBuf::from("rust/CHANGELOG.md")
    );
    assert!(needs_cd("rust"));
}

#[test]
fn rust_root_prefers_explicit_parameter() {
    assert_eq!(
        get_rust_root(Some("custom-root"), false).unwrap(),
        "custom-root"
    );
}

#[test]
fn rust_root_cli_parser_returns_none_without_configuration() {
    std::env::remove_var("RUST_ROOT");
    assert_eq!(parse_rust_root_from_args(), None);
}
