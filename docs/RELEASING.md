# Releasing Artemis

What is automated, what is not, and why.

## What CI does

`.github/workflows/ci.yml`.

**`check`** runs on macOS, Linux and Windows for every push and pull request:
typecheck, front-end tests, `cargo fmt --check`, `cargo clippy -D warnings`,
`cargo test`. The matrix is not ceremony — the scanner shipped three bugs that
were invisible on macOS and would each independently have made Artemis find *no
harnesses at all* on Windows. See `tests/portability.rs`.

Ignored tests stay ignored in CI. They run real agents, cost money, and need
credentials no runner has. Run them by hand:

```bash
OPENCODE_BIN=$(command -v opencode) cargo test --test opencode_live -- --ignored --nocapture
CODEX_BIN=$(command -v codex)       cargo test --test comparison    -- --ignored --nocapture
                                    cargo test --test quiver        -- --ignored --nocapture
```

**`build`** runs only on `workflow_dispatch` with `bundle: true`, and produces
unsigned installers for all three platforms as artifacts. Bundling on every push
would be slow and is rarely the question being asked.

## What is not automated, and cannot be from inside this repository

These need credentials or accounts that are not here and should never be
committed. Each is a deliberate gap, not an oversight.

### macOS signing and notarization

An unsigned `.app` copied from a download is quarantined by Gatekeeper and
refuses to open with a message that reads like corruption. Fixing it needs an
**Apple Developer ID** (a paid Apple Developer Program membership) and an
app-specific password or API key for notarization.

Once you have them, Tauri wants these in the environment at bundle time:

| Variable | What it is |
|---|---|
| `APPLE_CERTIFICATE` | base64 of the `.p12` Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | notarization, app-specific password |

They belong in repository secrets, and the `build` job needs them wired in
before its macOS artifact is distributable. **Until then the macOS build is
local-use only** — which is what today's `Artemis.app` is.

### Windows signing

Same shape, different authority: an Authenticode certificate from a CA.
Unsigned, SmartScreen warns on first run. Not blocking for early users; blocking
for anything public.

### Auto-update

Tauri's updater needs three things this repository does not have:

1. A **signing keypair** — `pnpm exec tauri signer generate`. The private key is
   a secret; the public key goes in `tauri.conf.json`.
2. An **endpoint** serving an update manifest, which means somewhere to host it.
3. A **version scheme**. `tauri.conf.json` currently says `0.0.0`, so no build
   can ever be newer than another.

Deliberately not configured. An updater pointed at an endpoint that does not
exist fails on every launch, and a keypair committed to make it "work" is worse
than no updater.

## Cross-platform, verified and unverified

The scanner's platform assumptions are fixed and tested — `PATH` splitting via
`std::env::split_paths`, `PATHEXT` extensions on Windows, both path separators
recognised.

**A full Windows compile cannot be done from macOS**: `libsqlite3-sys` builds C,
and cross-compiling it to MSVC needs the MSVC toolchain. What *was* verified
locally is that the `#[cfg(windows)]` code compiles for
`x86_64-pc-windows-msvc`, by lifting those functions into a standalone crate:

```bash
rustc --target x86_64-pc-windows-msvc --crate-type lib --edition 2021 wincheck.rs
```

CI is what actually compiles and tests all three, and is the only thing that
should be trusted for it.

**Neither Linux nor Windows has ever been run**, only compiled and tested. The
first real run on each will find something; the scanner tests mean it should not
be "no harnesses at all".

## Cutting a release

1. Set a real version in `apps/desktop/src-tauri/tauri.conf.json` and
   `package.json`.
2. Push; confirm `check` is green on all three platforms.
3. Run the `CI` workflow manually with `bundle: true`.
4. Download the artifacts. Without signing, macOS users need
   `xattr -dr com.apple.quarantine Artemis.app` — which is not something to ask
   of strangers, so see the signing section first.
