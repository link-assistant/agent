//! The local zizmor commands must collect the same inputs as its action.
use std::fs;

#[test]
fn zizmor_reproduction_and_pedantic_pass_scan_the_repository() {
    let workflow = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/.github/workflows/workflows.yml"
    ))
    .unwrap()
    .replace("\r\n", "\n");
    assert!(workflow.contains("          inputs: .\n"));
    assert!(workflow.contains("--min-confidence low --persona regular .\n"));
    assert!(workflow.contains(
        "--persona pedantic --min-severity high --min-confidence high \\\n            .\n"
    ));
    assert!(!workflow.contains(".github/workflows .github/actions"));
}
