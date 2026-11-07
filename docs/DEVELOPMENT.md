# Development

JulesDeck is the master source repository for Fedora and Debian. Both use the same TypeScript sources, Electron shell, and installer. Keep platform changes here and verify them with the Linux checks below.

Version 1.0.0 is the current release. Dependencies, browser profiles, credentials, and temporary test repositories are excluded from Git-tracked source.

## Checks

From the repository root:

```bash
npm ci
node node_modules/electron/install.js
npm run check
npm run build
```

`npm run check` runs typecheck (`tsc --noEmit`), lint (`eslint .`), and the Vitest test suite in one command. The suite has 296 cases across 13 files. The offline run passes 293 and skips three live Jules CLI checks. Automatic CI checks are configured in `.github/workflows/ci.yml` for pull requests and pushes.

Default tests use temporary profiles, local Git fixtures, and mocked coding processes without spending provider quota. Runtime user data defaults to `~/.config/JulesDeck`, and installed application files live in `~/.local/share/julesdeck` (overridable via `JULESDECK_HOME`). Optional graphical runners require an active display or Xvfb. Run them with `npm run test:e2e`, or run individual runners directly:

```bash
npm run test:e2e
npx electron tests/e2e_electron_runner.cjs --headless --no-sandbox
npx electron tests/e2e_julestest_runner.cjs --headless --no-sandbox
npx electron tests/e2e_local_ui_visibility_runner.cjs --headless --no-sandbox
npx electron tests/e2e_stress_runner.cjs --headless --no-sandbox
```

[Latest verification and remaining limits](VERIFICATION.md).

## Source map

| Directory | Contents |
| --- | --- |
| `src/main/` | Main process, window layout, IPC handlers, accounts, Chrome cookie import |
| `src/chrome/` | Top bar and Jules Local interface |
| `src/preload/` | Sandboxed preload bridge for the local interface |
| `src/shared/` | Shared TypeScript types and plan lifecycle state |
| `packaging/` | Linux installer, launcher, and desktop entry |
| `build/icons/` | Application icons (`32x32` through `512x512` and SVG) |
| `tests/`, `scripts/` | Regression, UI, and stress checks |

Screenshots in `docs/screenshots/` come from isolated UI tests with sample data.

## Web workspace boundaries

Cloud Jules runs inside a sandboxed Electron `WebContentsView` bound to a per-account persistent partition. The remote view has no preload script or access to local IPC, and top-level navigation is restricted to Google Jules and Google authentication hosts. External links open in the default desktop browser.

The top bar and Jules Local run in a separate local `WebContentsView` with `contextIsolation` and `sandbox` enabled. Switching Google accounts replaces only the Cloud Jules view and keeps the local repository state intact. Signing out clears cookies, storage, cache, and service workers for the active account partition without modifying local Git repositories or CLI credentials.

Local tasks run the selected coding engine in a detached process group so cancelling a run terminates the process tree. The legacy `jules` CLI is one optional engine. See [workspace comparison](PARITY.md) for the local, GitHub, and cloud boundaries.

## Before publishing

Review the [MIT license](../LICENSE) and README screenshots, run the checks above, and scan the commit history with `gitleaks git --redact --log-opts=--all .`.

The public repository starts with one initial 1.0 release commit. Check `git remote -v` before pushing changes. Release tags use `vMAJOR.MINOR.PATCH`, starting at `v1.0.0`.

[Back to JulesDeck](../README.md)

Live Jules CLI checks are opt-in through `JULESDECK_LIVE_CLI_TESTS=1`. They require a configured account and can contact the service. Keep them disabled for ordinary CI. The offline suite uses temporary CLI and Git fixtures; SQLite fixture checks require the `sqlite3` command.
