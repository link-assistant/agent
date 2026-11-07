use std::fs;

fn release_workflow() -> String {
    fs::read_to_string(format!(
        "{}/.github/workflows/release.yml",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("release workflow should exist")
    .replace("\r\n", "\n")
}

fn job_block<'a>(workflow: &'a str, job_name: &str) -> &'a str {
    let marker = format!("  {job_name}:\n");
    let start = workflow
        .find(&marker)
        .unwrap_or_else(|| panic!("workflow job {job_name:?} should exist"));
    let body_start = start + marker.len();
    let rest = &workflow[body_start..];
    let next_job = rest
        .lines()
        .scan(0usize, |offset, line| {
            let current_offset = *offset;
            *offset += line.len() + 1;
            Some((current_offset, line))
        })
        .find_map(|(offset, line)| {
            let starts_at_job_indent = line.starts_with("  ") && !line.starts_with("    ");
            (starts_at_job_indent && line.trim_end().ends_with(':')).then_some(offset)
        });
    next_job.map_or_else(
        || &workflow[start..],
        |end| &workflow[start..body_start + end],
    )
}

#[test]
fn docker_release_builds_both_platforms_on_native_runners() {
    let workflow = release_workflow();
    let publish = job_block(&workflow, "docker-publish");

    assert!(publish.contains("platform: linux/amd64"));
    assert!(publish.contains("runner: ubuntu-24.04"));
    assert!(publish.contains("platform: linux/arm64"));
    assert!(publish.contains("runner: ubuntu-24.04-arm"));
    assert!(publish.contains("runs-on: ${{ matrix.runner }}"));
    assert!(publish.contains("platforms: ${{ matrix.platform }}"));
    assert!(publish.contains("push-by-digest=true"));
    assert!(!workflow.contains("docker/setup-qemu-action"));
}

#[test]
fn manifest_merge_publishes_and_verifies_both_platforms() {
    let workflow = release_workflow();
    let merge = job_block(&workflow, "docker-merge-manifest");

    assert!(
        merge.contains("needs: [javascript-first, auto-release, manual-release, docker-publish, release-preflight]")
    );
    assert!(merge.contains("docker buildx imagetools create"));
    assert!(merge.contains("${DOCKERHUB_IMAGE}:latest"));
    assert!(merge.contains("${DOCKERHUB_IMAGE}:${RELEASE_VERSION}"));
    assert!(merge.contains("linux/amd64"));
    assert!(merge.contains("linux/arm64"));
}

#[test]
fn github_release_does_not_wait_for_docker_publication() {
    let workflow = release_workflow();

    for release_job in ["auto-release", "manual-release"] {
        let job = job_block(&workflow, release_job);
        assert!(job.contains("- name: Create GitHub Release"));
        assert!(!job.contains("docker/build-push-action"));
    }

    let publish = job_block(&workflow, "docker-publish");
    assert!(publish.contains(
        "needs: [release-javascript-first, auto-release, manual-release, release-preflight]"
    ));
}
