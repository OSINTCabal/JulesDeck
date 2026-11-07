# Verification

The current local source passed type checking, lint, a production build, and **296 tests** across 13 test files. Tests use temporary profiles, Git repositories, SQLite fixtures, simulated accounts, and mock coding processes. No paid provider request is needed for this suite.

## Packaging

Source installation completed in disposable Fedora 44 and Debian 12 containers with Node 24.16.0 and isolated application, data, configuration, and launcher directories. The installer builds the desktop assets and copies a self-contained Electron dependency tree. Host installation also exercised paths containing spaces; the generated desktop command is quoted.

The build command stops on a compiler or asset-copy failure. Tests verify Git task branching, local publishing fixtures, account handling, cancellation, and recovery paths. The test count is separate from the optional graphical runners under `tests/e2e_*`.

## Limits

Fresh browser consent, Chrome session import with a real account, live cloud availability, paid coding tasks, and all graphical workflows were not repeated during this packaging review. Mock account tests are not evidence of a successful live sign-in.

Local Git tools and configured coding engines are separate from the optional Cloud Jules page. Each engine needs its own authentication and supported model. GitHub remote actions need GitHub CLI authorization.

[Back to JulesDeck](../README.md)

## Installer and documentation review, 2026-11-06

Fresh source installation completed on Fedora 44 and Debian 12. Type checking, lint, the production build, and 296 tests across 13 files passed during the packaging review. The installation, development, and parity guides now describe the supported local engines and separate mocked account checks from real browser consent.

Source secret scans, shell syntax, and local Markdown links passed. These checks used disposable installations and fixtures. Fresh interactive sign-in, paid requests, and full graphical acceptance were not repeated; existing account profiles were left in place.

## 1.0 release verification

Fresh source installation, the regression suite, desktop-entry validation, and clean-profile launch completed on Fedora 44 and Debian 13. Tests ran as an unprivileged user with isolated application, configuration, launcher, and data paths. Launcher paths included spaces.

Virtual display captures used container-only sandbox and software-rendering options; these options were not added to production launchers. Fresh browser consent, paid requests, real account persistence, and complete graphical workflows were not exercised.

The offline suite passes 293 tests across 13 files and skips three explicitly opt-in live CLI checks. CLI discovery and Git tests use temporary fixtures; no real coding providers are invoked.
