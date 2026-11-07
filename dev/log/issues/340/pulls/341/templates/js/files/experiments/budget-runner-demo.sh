#!/usr/bin/env bash
# Manual demonstration of scripts/run-with-budget-warning.sh (issue #137).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

echo "--- success passthrough ---"
bash scripts/run-with-budget-warning.sh 5 "quick step" bash -c 'echo hello; exit 0'
echo "exit=$?"

echo "--- failure passthrough ---"
bash scripts/run-with-budget-warning.sh 5 "failing step" bash -c 'exit 3'
echo "exit=$?"

echo "--- over budget, with worker orphan ---"
BUDGET_WARN_PERCENT=50 BUDGET_GRACE_SECONDS=2 \
  bash scripts/run-with-budget-warning.sh 2 "slow suite" bash -c 'sleep 300 & sleep 300'
echo "exit=$?"
