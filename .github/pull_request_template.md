## What changed

<!-- One or two sentences. What a reviewer needs before reading the diff. -->

## Why

<!-- The problem, not the solution. If it fixes an issue, link it. -->

## How it was verified

<!--
Not "tests pass" — which tests, and what would have failed before.
If it touches a harness, say whether it was run against the real binary:
the adapters exist because captured output disagreed with documentation.
-->

- [ ] `pnpm test` and `cargo test`
- [ ] `pnpm -r typecheck`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`
- [ ] Ran against a real harness, if this touches one

## Anything deliberately left out

<!--
Scope you decided not to take on, or a limitation the change ships with.
Saying so here is better than leaving it to be discovered.
-->
