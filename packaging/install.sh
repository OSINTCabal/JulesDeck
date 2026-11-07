#!/usr/bin/env bash
# JulesDeck user-level installer (no root required).
# Supports Fedora and Debian Linux distributions.
set -euo pipefail

DISTRO="auto"

show_help() {
  cat <<'EOF'
Usage: ./packaging/install.sh [OPTIONS]

User-level installer for JulesDeck (no root required).
Builds the TypeScript & Chrome frontend, installs application assets into
XDG data directories, installs the user launcher, desktop entry, and icons.

Options:
  --distro=fedora|debian|auto   Target Linux distribution (default: auto)
  -h, --help                    Show this help message and exit

Prerequisites:
  Fedora:
    sudo dnf install nodejs npm git sqlite libsecret nss atk at-spi2-atk mesa-libgbm alsa-lib desktop-file-utils gtk3

  Debian 13:
    # Requires Node.js 22.12+ and npm (e.g. via Node.js official downloads or NVM)
    sudo apt install git sqlite3 libsecret-tools libsecret-1-0 libnss3 libatk-bridge2.0-0t64 libgbm1 libasound2t64 desktop-file-utils libgtk-3-bin

Environment Overrides:
  JULESDECK_HOME                  App install root (default: ~/.local/share/julesdeck)
  JULESDECK_JULES_BIN             Custom path to the Google Jules CLI binary
  JULESDECK_SYMLINK_NODE_MODULES  Set to 1 to symlink node_modules instead of copying
  XDG_BIN_HOME                    User binary directory (default: ~/.local/bin)
  XDG_DATA_HOME                   User data directory (default: ~/.local/share)
  XDG_CONFIG_HOME                 User config directory (default: ~/.config)
EOF
}

# Parse command line options
while [ $# -gt 0 ]; do
  case "$1" in
    --distro=*)
      DISTRO="${1#*=}"
      shift
      ;;
    --distro)
      if [ -n "${2:-}" ]; then
        DISTRO="$2"
        shift 2
      else
        printf '\033[31mError:\033[0m --distro requires an argument (fedora|debian|auto)\n' >&2
        exit 1
      fi
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      printf '\033[31mError:\033[0m Unknown option: %s (see --help)\n' "$1" >&2
      exit 1
      ;;
  esac
done

case "$DISTRO" in
  fedora|debian|auto) ;;
  *)
    printf '\033[31mError:\033[0m Unsupported distro "%s". Allowed: fedora, debian, auto\n' "$DISTRO" >&2
    exit 1
    ;;
esac

# Auto-detect Linux distribution from /etc/os-release if requested
if [ "$DISTRO" = "auto" ]; then
  if [ -f /etc/os-release ]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    OS_DETECT="${ID:-} ${ID_LIKE:-}"
    case "$OS_DETECT" in
      *fedora*|*rhel*|*centos*|*rocky*|*alma*)
        DISTRO="fedora"
        ;;
      *debian*|*ubuntu*|*pop*|*mint*)
        DISTRO="debian"
        ;;
      *)
        DISTRO="fedora"
        ;;
    esac
  else
    DISTRO="fedora"
  fi
fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP="${JULESDECK_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/julesdeck}"
BIN="${XDG_BIN_HOME:-$HOME/.local/bin}"
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/julesdeck"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
LAUNCHER="$BIN/julesdeck"

say() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
die() { printf '\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$SRC" != "$APP" ] || die "Install from a source checkout, not the installed app."

# ---- 1. Preflight checks ----------------------------------------------------
# Dynamically augment PATH with $HOME/.local/bin and existing NVM Node versions (newest first)
NVM_PATH_PREFIX=""
if [ -d "$HOME/.nvm/versions/node" ]; then
  while IFS= read -r dir; do
    if [ -d "$dir/bin" ]; then
      case ":$PATH:" in
        *":$dir/bin:"*) ;;
        *) NVM_PATH_PREFIX="${NVM_PATH_PREFIX:+$NVM_PATH_PREFIX:}$dir/bin" ;;
      esac
    fi
  done < <(find "$HOME/.nvm/versions/node" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -Vr)
fi
if [ -n "$NVM_PATH_PREFIX" ]; then
  PATH="$NVM_PATH_PREFIX:$PATH"
fi

if [ -d "$HOME/.local/bin" ]; then
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) PATH="$HOME/.local/bin:$PATH" ;;
  esac
fi
export PATH

say "Checking prerequisites ($DISTRO mode)"

if [ "$DISTRO" = "fedora" ]; then
  INSTALL_CMD="sudo dnf install nodejs npm git sqlite libsecret nss atk at-spi2-atk mesa-libgbm alsa-lib desktop-file-utils gtk3"
else
  INSTALL_CMD="sudo apt install git sqlite3 libsecret-tools libsecret-1-0 libnss3 libatk-bridge2.0-0t64 libgbm1 libasound2t64 desktop-file-utils libgtk-3-bin (plus Node.js 22.12+ and npm)"
fi

command -v node >/dev/null 2>&1 || die "Node.js not found. $INSTALL_CMD"
command -v npm  >/dev/null 2>&1 || die "npm not found. $INSTALL_CMD"
command -v git  >/dev/null 2>&1 || die "git not found. $INSTALL_CMD"

# Verify Node.js is version 22.12 or higher
NODE_VER="$(node -e '
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (!(major > 22 || (major === 22 && minor >= 12))) {
    console.error("Node 22.12+ required, found " + process.versions.node);
    process.exit(1);
  }
  console.log(process.versions.node);
' 2>/dev/null)" || die "Node.js 22.12+ required (found $(node --version 2>/dev/null || echo 'unknown')). $INSTALL_CMD"

printf '    node        %s\n' "$NODE_VER"
printf '    npm         %s\n' "$(npm --version)"
printf '    git         %s\n' "$(git --version | awk '{print $3}')"

say "Checking optional integrations"

if command -v jules >/dev/null 2>&1; then
  JULES_VER="$(jules version 2>/dev/null | grep -i "version:" | head -1 | awk '{print $2}' || true)"
  [ -n "$JULES_VER" ] || JULES_VER="available"
  printf '    jules       %s (%s)\n' "$JULES_VER" "$(command -v jules)"
else
  printf '    jules       not found (optional: npm install --global --prefix "$HOME/.local" @google/jules)\n'
fi

if command -v sqlite3 >/dev/null 2>&1; then
  printf '    sqlite3     %s (%s)\n' "$(sqlite3 --version 2>/dev/null | awk '{print $1}')" "$(command -v sqlite3)"
else
  if [ "$DISTRO" = "fedora" ]; then
    printf '    sqlite3     not found (optional: sudo dnf install sqlite)\n'
  else
    printf '    sqlite3     not found (optional: sudo apt install sqlite3)\n'
  fi
fi

if command -v secret-tool >/dev/null 2>&1; then
  printf '    secret-tool available (%s)\n' "$(command -v secret-tool)"
else
  if [ "$DISTRO" = "fedora" ]; then
    printf '    secret-tool not found (optional keyring support: sudo dnf install libsecret)\n'
  else
    printf '    secret-tool not found (optional keyring support: sudo apt install libsecret-tools)\n'
  fi
fi

# ---- 2. Build assets --------------------------------------------------------
say "Building JulesDeck in $SRC"
if [ ! -x "$SRC/node_modules/electron/dist/electron" ]; then
  say "Installing dependencies via npm ci"
  ( cd "$SRC" && npm ci --no-audit --no-fund )
  if [ ! -x "$SRC/node_modules/electron/dist/electron" ] && [ -f "$SRC/node_modules/electron/install.js" ]; then
    ( cd "$SRC" && node node_modules/electron/install.js )
  fi
fi
( cd "$SRC" && npm run build )

# ---- 3. Install into APP directory ------------------------------------------
say "Installing application to $APP"
mkdir -p "$APP" "$BIN" "$APPS" "$ICONS" "$CFG"

STAGE="$(mktemp -d "$APP/.install-XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

cp -a "$SRC/dist" "$STAGE/dist"
cp -a "$SRC/build" "$STAGE/build"
cp -a "$SRC/package.json" "$STAGE/package.json"
[ -f "$SRC/LICENSE" ] && cp -a "$SRC/LICENSE" "$STAGE/LICENSE"

for part in dist build package.json LICENSE; do
  if [ -e "$STAGE/$part" ]; then
    rm -rf "$APP/$part"
    mv "$STAGE/$part" "$APP/$part"
  fi
done

rm -rf "$STAGE"
trap - EXIT

# Handle node_modules copying (self-contained by default) or symlinking
if [ "${JULESDECK_SYMLINK_NODE_MODULES:-0}" = "1" ]; then
  say "Symlinking node_modules (JULESDECK_SYMLINK_NODE_MODULES=1)"
  rm -rf "$APP/node_modules"
  ln -sfn "$SRC/node_modules" "$APP/node_modules"
else
  say "Copying node_modules for a self-contained install"
  rm -rf "$APP/node_modules"
  cp -a "$SRC/node_modules" "$APP/node_modules"
fi

if [ ! -x "$APP/node_modules/electron/dist/electron" ]; then
  chmod +x "$APP/node_modules/electron/dist/electron" 2>/dev/null || true
fi
[ -x "$APP/node_modules/electron/dist/electron" ] || die "Electron binary not executable at $APP/node_modules/electron/dist/electron"

# ---- 4. Install launcher ----------------------------------------------------
say "Installing launcher to $LAUNCHER"
if [ -e "$LAUNCHER" ]; then
  cp -a "$LAUNCHER" "$BIN/julesdeck.bak"
  printf '    previous launcher kept as %s\n' "$BIN/julesdeck.bak"
fi
install -m 0755 "$SRC/packaging/bin/julesdeck" "$LAUNCHER"

# ---- 5. Install desktop entry -----------------------------------------------
say "Installing desktop entry"
node - "$SRC/packaging/julesdeck.desktop" "$APPS/julesdeck.desktop" "$LAUNCHER" <<'JS'
const fs=require('fs');fs.writeFileSync(process.argv[3],fs.readFileSync(process.argv[2],'utf8').replace(/^Exec=.*$/m,()=> 'Exec='+JSON.stringify(process.argv[4])+' %U'));
JS
chmod 0644 "$APPS/julesdeck.desktop"

if command -v desktop-file-validate >/dev/null 2>&1; then
  if desktop-file-validate "$APPS/julesdeck.desktop"; then
    printf '    desktop-file-validate: OK\n'
  else
    die "desktop-file-validate rejected $APPS/julesdeck.desktop"
  fi
fi

# ---- 6. Install icons -------------------------------------------------------
say "Installing application icons"
for size in 32x32 64x64 128x128 256x256 512x512; do
  mkdir -p "$ICONS/$size/apps"
  if [ -f "$SRC/build/icons/$size.png" ]; then
    install -m 0644 "$SRC/build/icons/$size.png" "$ICONS/$size/apps/julesdeck.png"
  fi
done

if [ -f "$SRC/build/icons/icon.svg" ]; then
  mkdir -p "$ICONS/scalable/apps"
  install -m 0644 "$SRC/build/icons/icon.svg" "$ICONS/scalable/apps/julesdeck.svg"
fi

# ---- 7. Refresh caches ------------------------------------------------------
say "Refreshing desktop and icon caches"
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$ICONS" >/dev/null 2>&1 || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true

# ---- 8. Configuration environment -------------------------------------------
WRITE_DEFAULT_ENV=0
if [ ! -f "$CFG/env" ]; then
  WRITE_DEFAULT_ENV=1
elif grep -q '# export JULES_PATH=""' "$CFG/env" 2>/dev/null && ! grep -qvE '^\s*(#|$)' "$CFG/env" 2>/dev/null; then
  WRITE_DEFAULT_ENV=1
fi

if [ "$WRITE_DEFAULT_ENV" = "1" ]; then
  say "Creating default configuration at $CFG/env"
  cat > "$CFG/env" <<'EOF'
# JulesDeck environment configuration — sourced by launcher (~/.local/bin/julesdeck).
# File permissions should remain 0600.

# Electron Ozone platform hint (x11 or wayland)
# export ELECTRON_OZONE_PLATFORM_HINT="x11"

# Custom Google Jules CLI binary path or install directory overrides (if needed)
# export JULESDECK_JULES_BIN=""
# export JULESDECK_HOME=""
EOF
  chmod 0600 "$CFG/env"
fi

cat <<EOF

Installed.

  App        $APP
  Launcher   $LAUNCHER
  Drawer     $APPS/julesdeck.desktop
  Icons      $ICONS/{32,64,128,256,512}x…/apps/julesdeck.png
             $ICONS/scalable/apps/julesdeck.svg
  Config     $CFG/env

Next steps

  1. Launch "JulesDeck" from the app drawer, or run:  julesdeck
  2. Sign in with Google Jules or select a local workspace repository.
  3. After editing code in the project folder, re-run this script to push
     the changes into the installed copy.

Notes

  * If JulesDeck does not appear in the drawer immediately, log out and back
    in — desktop environments cache the application list.
  * To uninstall: remove $LAUNCHER, $APPS/julesdeck.desktop, the julesdeck*
    entries under $ICONS, $CFG, ${XDG_CONFIG_HOME:-$HOME/.config}/JulesDeck, and $APP.

EOF
