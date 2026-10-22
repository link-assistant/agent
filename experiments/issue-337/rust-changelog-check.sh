#!/usr/bin/env bash
# Runs the Rust "Check for changelog fragments" step body from
# .github/workflows/rust.yml against the working tree (issue #337).
# Usage: BASE_REF=main bash experiments/issue-337/rust-changelog-check.sh
set -e
BASE_REF="${BASE_REF:-main}"
body=$(awk '/- name: Check for changelog fragments/{f=1} f&&/run: \|/{r=1;next} r&&/^  [a-z#]/{exit} r{sub(/^          /,"");print}' .github/workflows/rust.yml)
BASE_REF="$BASE_REF" bash -e -c "$body"
