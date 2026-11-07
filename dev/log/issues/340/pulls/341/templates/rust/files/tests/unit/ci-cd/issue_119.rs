use std::fs;

fn release_workflow() -> String {
    fs::read_to_string(format!(
        "{}/.github/workflows/release.yml",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("release workflow should exist")
}

#[test]
fn every_docker_build_uses_the_gha_layer_cache() {
    let workflow = release_workflow();
    let build_steps = workflow
        .split("      - name: ")
        .filter(|step| step.contains("uses: docker/build-push-action@v7"))
        .collect::<Vec<_>>();

    assert_eq!(build_steps.len(), 2, "expected both Docker build steps");
    for step in build_steps {
        let step = step.split("\n      - name: ").next().unwrap();
        assert!(
            step.contains("cache-from: type=gha"),
            "Docker build step must restore the shared GHA layer cache:\n{step}"
        );
        assert!(
            step.contains("cache-to: type=gha,mode=max"),
            "Docker build step must save all layers to the shared GHA cache:\n{step}"
        );
    }
}
