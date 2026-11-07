# Install JulesDeck

Fedora and Debian use the same source installer. You need Node 22.12 or newer, npm, Git, and the Electron desktop libraries. SQLite and libsecret support local session import and credential access. A graphical session is required to open the window.

## System packages

**Fedora 44**

```bash
sudo dnf install nodejs npm git sqlite libsecret nss atk at-spi2-atk mesa-libgbm alsa-lib desktop-file-utils gtk3
```

**Debian 13**

```bash
sudo apt update
sudo apt install git sqlite3 libsecret-tools libsecret-1-0 libnss3 libatk-bridge2.0-0t64 libgbm1 libasound2t64 desktop-file-utils libgtk-3-bin
```

Install Node 22.12 or newer and npm separately if your distribution provides an older version. The package list above targets Debian 13. Chrome or Chromium is optional for importing a browser session into the legacy cloud page.

## Install and launch

```bash
bash packaging/install.sh
~/.local/bin/julesdeck
```

The installer writes to `~/.local/share/julesdeck`, installs the application-menu entry, and preserves saved accounts and recent repositories. Finish active turns and close the app before reinstalling. Use `JULESDECK_HOME`, `XDG_BIN_HOME`, `XDG_DATA_HOME`, and `XDG_CONFIG_HOME` for disposable installation tests.

## Coding engines and accounts

Choose a coding engine in Settings or the composer. Install and authenticate that engine separately: Gemini CLI, Codex, Claude Code, OpenCode, Aider, or the optional legacy Jules CLI. Cloud Jules sign-in does not authenticate another engine. Local Git inspection works without a coding engine; model-backed tasks need one.

GitHub repository discovery and pull request publishing need Git and an authenticated GitHub CLI. A local repository does not need GitHub authorization unless you use those remote actions.

`Ctrl+1` selects the optional Cloud Jules view, `Ctrl+2` selects Local, and `Ctrl+3` selects GitHub / Repo. Cloud availability and browser consent are controlled by Google. The local repository tools and configured coding engines are separate from that service.

[Back to JulesDeck](../README.md)
