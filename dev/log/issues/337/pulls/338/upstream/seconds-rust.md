## Problem

`scripts/run-with-budget-warning.sh` can terminate a command that finishes **inside** its budget, failing the step with exit code 124 and a false `::error title=... exceeded its execution budget::`.

The budget check compares bash's `SECONDS` with `-ge`:

https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/blob/265219d098ec1c6acbe6749562c2f3dc057f0df8/scripts/run-with-budget-warning.sh#L140

```bash
  if [ "$SECONDS" -ge "$budget_seconds" ]; then terminate_over_budget "$@"; fi
```

`SECONDS` is not elapsed time. It counts the wall-clock second boundaries crossed since `SECONDS=0`, so a few milliseconds after the reset it can already read 1. It is computed from whole-second timestamps, so it over-reads elapsed time by up to one second (the reproduction below shows this). `[ "$SECONDS" -ge N ]` is therefore true after only N-1+ε seconds, and the deadline fires up to a whole second early. The same applies to the grace-period loop (`[ "$SECONDS" -lt "$deadline" ]`, line 110).

### Where it happened

This wrapper was ported to link-assistant/agent, and its own unit test failed on the `macos-latest` runner (run [39827151731](https://github.com/link-assistant/agent/actions/runs/39827151731), job "Unit Tests (Bun on macos-latest)"). The test was `sleep 2` under a 3s budget, and it got:

```
error: expect(received).toBe(expected)
Expected: 0
Received: 124
(fail) run-with-budget-warning.sh > warns while the overrun can still be acted on [3091.14ms]
```

That red run blocked a release.

## Reproduction (deterministic, Linux, GNU date)

Starting the wrapper 0.75s into a wall-clock second makes `SECONDS` reach 2 after about 1.25s, before a 1.4s command finishes:

```bash
# from the template root
while :; do ms=$(date +%3N); ms=$((10#$ms)); [ "$ms" -ge 750 ] && [ "$ms" -lt 780 ] && break; done
BUDGET_POLL_SECONDS=0.1 BUDGET_GRACE_SECONDS=1 \
  bash scripts/run-with-budget-warning.sh 2 "aligned step" sleep 1.4
echo "exit=$?"   # prints exit=124: a 1.4s command killed under a 2s budget
```

On commit 265219d this failed every time we tried (5 of 5 runs: 3 with the Node aligner below, 2 with this snippet). A portable Node version that aligns with `Date.now()` is in [experiments/issue-337/budget-early-kill.mjs](https://github.com/link-assistant/agent/blob/d274daa8c23ff9a970caaaa1438ea65281500b13/experiments/issue-337/budget-early-kill.mjs).

## Suggested fix

Require `SECONDS` to be **strictly greater** than the deadline. `SECONDS` over-reads by less than one second, so a reading greater than N proves that N seconds really have passed:

```bash
# bash's SECONDS counts wall-clock second boundaries, not elapsed time, so
# a reading strictly greater than N proves N seconds have passed.
has_elapsed() { [ "${SECONDS}" -gt "$1" ]; }

# budget check
if has_elapsed "${budget_seconds}"; then terminate_over_budget ...; fi
# grace / kill waits
while command_is_running && ! has_elapsed "${deadline}"; do ...; done
```

With this the step can overrun by up to one extra second instead of being killed up to one second early. The `timeout-minutes` backstop is much larger, so that costs nothing. The warning threshold can stay on `-ge`, because an early warning is harmless.

A regression test that starts just before a second boundary (`sleep 1.4` under a `2`s budget, `BUDGET_POLL_SECONDS=0.1`) catches it deterministically. See `never terminates a command that finishes inside its budget (#337)` in [js/tests/run-with-budget-warning.js](https://github.com/link-assistant/agent/blob/d274daa8c23ff9a970caaaa1438ea65281500b13/js/tests/run-with-budget-warning.js).

## Workaround

Until this is fixed, give every budget at least one extra second. That hides the bug but doesn't remove it.

Found while working on link-assistant/agent#337, fixed in link-assistant/agent#338.
