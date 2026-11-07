# A working JavaScript-first caller

This small mixed-language example implements one complete API: integer parity.
It has no CLI, persistence or deployment behavior. Native JavaScript tests check
observations, refusal cases and signed integer boundaries before any Rust work.
The strict inventory rejects absent, partial, carried and unexpected entries.

Run the three actual prerequisite commands from the repository root:

```sh
node --test examples/javascript-first/native-check.mjs
node examples/javascript-first/check-parity.mjs --strict
node examples/javascript-first/generate.mjs --check
```

The dependency-free translator accepts exactly the documented source grammar,
refuses unsupported source, pins both source and translator SHA-256 hashes, and
preserves a typed intermediate representation alongside the generated Rust.
After an intentional reviewed source/generator change, regenerate with
`node examples/javascript-first/generate.mjs --update-pins` and review all artifacts.
This is a limited translator, not a claim of general JavaScript-to-Rust support.

The callable workflow's checked revision feeds every downstream checkout in
`javascript-first-example.yml`. Rust checks, compilation, native shared-fixture
tests, source packaging, a source container and artifact publication all depend
on gate success. Publication here means a read-only workflow artifact, so this
example requires no registry credentials. Rust's typed input enforces the i32
domain that JavaScript checks at runtime. Both native runtimes execute the same
observations; a successful source regeneration alone is not execution parity.

The example runs on pull requests and trusted pushes to main. PR code executes
in the PR's cache scope. It does not expose a manual-dispatch path that could
execute caller-selected code with main's runner cache credentials; disabling
dependency caching alone does not remove those credentials.

The root regression suite runs the workflow's actual shell steps in temporary
Git repositories. Deliberate native-test failure, skipped prerequisites, every
incomplete inventory state, generated drift, dirty worktrees and revision changes
must prevent all six downstream paths. The workflow supplies the independent
Rust execution on a suitably provisioned CI runner.
