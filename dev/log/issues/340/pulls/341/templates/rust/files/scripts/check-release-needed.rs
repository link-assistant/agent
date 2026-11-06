#!/usr/bin/env rust-script
//! Check if a release is needed based on changelog fragments and version state
//!
//! This script checks:
//! 1. If there are changelog fragments to process
//! 2. If the current version has already been published to crates.io
//! 3. If the matching GitHub release and configured Docker Hub image tag exist
//!
//! IMPORTANT: This script checks external release artifacts, NOT git tags.
//! This is critical because:
//! - Git tags can exist without the package being published
//! - GitHub releases create tags but do not publish to crates.io or Docker Hub
//! - A crates.io publish can succeed while later Docker/GitHub release steps fail
//!
//! Supports both single-language and multi-language repository structures:
//! - Single-language: Cargo.toml in repository root
//! - Multi-language: Cargo.toml in rust/ subfolder
//!
//! Usage: rust-script scripts/check-release-needed.rs [--rust-root <path>]
//!
//! Environment variables:
//!   - HAS_FRAGMENTS: 'true' if changelog fragments exist (from get-bump-type.rs)
//!   - DOCKERHUB_IMAGE: Optional Docker Hub image name to verify (namespace/repository)
//!   - GITHUB_REPOSITORY: GitHub repository to verify (owner/repository)
//!
//! Outputs (written to GITHUB_OUTPUT):
//!   - should_release: 'true' if a release should be created
//!   - skip_bump: 'true' if version bump should be skipped while missing artifacts are recreated
//!   - crate_published: 'true' if the current version already exists on crates.io
//!   - dockerhub_required: 'true' if Docker Hub publishing is configured and a Dockerfile exists
//!   - dockerhub_published: 'true' if the configured Docker Hub tag exists
//!   - github_release_published: 'true' if the matching GitHub release exists
//!   - max_published_version: the highest non-yanked version on crates.io (for downstream use)
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ureq = "2"
//! serde = { version = "1", features = ["derive"] }
//! serde_json = "1"
//! ```

use std::env;
use std::path::Path;
use std::process::exit;

#[path = "release-naming.rs"]
mod release_naming;
#[path = "rust-paths.rs"]
mod rust_paths;

fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{}", name);

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        return args.get(idx + 1).cloned();
    }

    let env_name = name.to_uppercase().replace('-', "_");
    env::var(&env_name).ok().filter(|s| !s.is_empty())
}

#[path = "github-output.rs"]
mod github_output;

fn set_output(key: &str, value: &str) -> std::io::Result<()> {
    github_output::write_output(key, value)?;
    println!("Output: {key}={value}");
    Ok(())
}

#[path = "registry.rs"]
mod registry;

fn check_version_on_crates_io(crate_name: &str, version: &str) -> bool {
    registry::or_exit(
        "crates.io version lookup",
        registry::version_exists(crate_name, version),
    )
}

fn split_docker_image(image: &str) -> Option<(&str, &str)> {
    let mut parts = image.split('/');
    let namespace = parts.next()?;
    let repository = parts.next()?;

    if parts.next().is_some() || namespace.is_empty() || repository.is_empty() {
        None
    } else {
        Some((namespace, repository))
    }
}

fn check_docker_hub_tag(image: &str, version: &str) -> bool {
    let (namespace, repository) = split_docker_image(image).unwrap_or_else(|| {
        eprintln!("::error::Invalid Docker Hub image '{image}'; expected namespace/repository");
        exit(1);
    });
    let url =
        format!("https://hub.docker.com/v2/repositories/{namespace}/{repository}/tags/{version}");
    registry::or_exit(
        "Docker Hub tag lookup",
        registry::artifact_exists(&url, &[], "name", version),
    )
}

fn check_github_release(repository: &str, tag_prefix: &str, version: &str) -> bool {
    let url =
        format!("https://api.github.com/repos/{repository}/releases/tags/{tag_prefix}{version}");
    let token = env::var("GITHUB_TOKEN").unwrap_or_default();
    let authorization = format!("Bearer {token}");
    let mut headers = vec![("Accept", "application/vnd.github+json")];
    if !token.is_empty() {
        headers.push(("Authorization", authorization.as_str()));
    }
    registry::or_exit(
        "GitHub release lookup",
        registry::artifact_exists(
            &url,
            &headers,
            "tag_name",
            &format!("{tag_prefix}{version}"),
        ),
    )
}

fn docker_hub_image_to_check() -> Option<String> {
    get_arg("dockerhub-image")
        .or_else(|| get_arg("docker-hub-image"))
        .or_else(|| get_arg("dockerhub_image"))
        .filter(|image| Path::new("Dockerfile").exists() && !image.trim().is_empty())
}

fn release_is_complete(
    crate_published: bool,
    dockerhub_required: bool,
    dockerhub_published: bool,
    github_release_published: bool,
) -> bool {
    crate_published && (!dockerhub_required || dockerhub_published) && github_release_published
}

fn get_max_published_version(crate_name: &str) -> Option<String> {
    registry::or_exit(
        "crates.io maximum-version lookup",
        registry::max_published_name(crate_name),
    )
}

fn main() -> std::io::Result<()> {
    let rust_root = match rust_paths::get_rust_root(None, true) {
        Ok(root) => root,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let cargo_toml = rust_paths::get_cargo_toml_path(&rust_root);
    let package_manifest = match rust_paths::get_package_manifest_path(&cargo_toml) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };

    let has_fragments = env::var("HAS_FRAGMENTS")
        .map(|v| v == "true")
        .unwrap_or(false);

    let package_info = match rust_paths::read_package_info(&package_manifest) {
        Ok(info) => info,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let crate_name = package_info.name;
    let current_version = package_info.version;

    let max_published = get_max_published_version(&crate_name);
    if let Some(ref max_ver) = max_published {
        println!("Max published version on crates.io: {}", max_ver);
        set_output("max_published_version", max_ver)?;
    } else {
        println!("No versions published on crates.io yet (or crate not found)");
        set_output("max_published_version", "")?;
    }

    if !has_fragments {
        let crate_published = check_version_on_crates_io(&crate_name, &current_version);
        let tag_prefix = get_arg("tag-prefix")
            .unwrap_or_else(|| release_naming::tag_prefix_for_rust_root(&rust_root).to_string());
        let dockerhub_image = docker_hub_image_to_check();
        let dockerhub_required = dockerhub_image.is_some();
        let dockerhub_published = dockerhub_image
            .as_deref()
            .map(|image| {
                check_docker_hub_tag(image, &current_version)
                    && check_docker_hub_tag(image, "latest")
            })
            .unwrap_or(false);
        let github_release_published = get_arg("repository")
            .or_else(|| env::var("GITHUB_REPOSITORY").ok().filter(|s| !s.is_empty()))
            .map(|repository| check_github_release(&repository, &tag_prefix, &current_version))
            .unwrap_or_else(|| {
                eprintln!("Warning: GITHUB_REPOSITORY not set; assuming GitHub release is missing");
                false
            });

        set_output(
            "crate_published",
            if crate_published { "true" } else { "false" },
        )?;
        set_output(
            "dockerhub_required",
            if dockerhub_required { "true" } else { "false" },
        )?;
        set_output(
            "dockerhub_published",
            if dockerhub_published { "true" } else { "false" },
        )?;
        set_output(
            "github_release_published",
            if github_release_published {
                "true"
            } else {
                "false"
            },
        )?;

        println!(
            "Crate: {}, Version: {}, Published on crates.io: {}",
            crate_name, current_version, crate_published
        );
        if let Some(image) = dockerhub_image {
            println!(
                "Docker image: {}, version/latest tags published on Docker Hub: {}",
                image, dockerhub_published
            );
        } else {
            println!("Docker Hub artifact check skipped: DOCKERHUB_IMAGE or Dockerfile is not configured");
        }
        println!(
            "GitHub release {}{} published: {}",
            tag_prefix, current_version, github_release_published
        );

        if release_is_complete(
            crate_published,
            dockerhub_required,
            dockerhub_published,
            github_release_published,
        ) {
            println!(
                "No changelog fragments and v{} is fully published",
                current_version
            );
            set_output("should_release", "false")?;
        } else {
            println!(
                "No changelog fragments but v{} is missing at least one release artifact",
                current_version
            );
            set_output("should_release", "true")?;
            set_output("skip_bump", "true")?;
        }
    } else {
        println!("Found changelog fragments, proceeding with release");
        set_output("should_release", "true")?;
        set_output("skip_bump", "false")?;
    }
    Ok(())
}
