#!/usr/bin/env bash
# ==============================================================================
# JulesDeck — Session Artifact & Ephemeral Cache Cleaner
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "========================================================"
echo "   JulesDeck Local Session & Cache Cleaner"
echo "========================================================"

PURGED_DIRS=0
PURGED_FILES=0

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

echo "[CLEAN] Scanning and purging stale /tmp session directories..."
for dir in /tmp/julesdeck-live-electron-* /tmp/jules-nongit-* /tmp/julesdeck-stress-* /tmp/jules-accounts-test-* /tmp/julesdeck-init-test-* /tmp/jules-recent-test-* /tmp/jules-purge-test-*; do
  if [ -d "$dir" ]; then
    rm -rf "$dir"
    PURGED_DIRS=$((PURGED_DIRS + 1))
  fi
done

echo "[CLEAN] Scanning and purging stale temporary scripts & logs..."
for f in /tmp/inspect_jules*.cjs /tmp/take_cloud_screenshot.cjs /tmp/verify_local_ui*.cjs /tmp/jules*.log; do
  if [ -f "$f" ]; then
    rm -f "$f"
    PURGED_FILES=$((PURGED_FILES + 1))
  fi
done

if [ -f "$HOME/.jules/cache/cli.log" ]; then
  rm -f "$HOME/.jules/cache/cli.log"
  echo "[CLEAN] Reset ~/.jules/cache/cli.log"
  PURGED_FILES=$((PURGED_FILES + 1))
fi

echo "[CLEAN] Purging old remote sessions from local directory section..."
REPO_ROOT="$REPO_ROOT" node -e '
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

try {
  const res = spawnSync("jules", ["remote", "list", "--session"], { encoding: "utf8", timeout: 10000 });
  const stdout = res.stdout || "";
  const ids = stdout.split("\n").slice(1).map(l => l.trim().split(/\s+/)[0]).filter(id => /^\d+$/.test(id));
  
  const repoRoot = process.env.REPO_ROOT || "";
  const targets = [
    path.join(process.env.HOME || "", ".config/JulesDeck/deleted-sessions.json"),
    path.join(repoRoot, "deleted-sessions.json")
  ];

  for (const target of targets) {
    try {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let existing = [];
      if (fs.existsSync(target)) {
        try { existing = JSON.parse(fs.readFileSync(target, "utf8")); } catch {}
      }
      const combined = Array.from(new Set([...existing, ...ids]));
      fs.writeFileSync(target, JSON.stringify(combined, null, 2), "utf8");
    } catch (e) {
      // ignore
    }
  }

  // Reset recent repos to clean state
  const repoTargets = [
    path.join(process.env.HOME || "", ".config/JulesDeck/recent-repos.json"),
    path.join(repoRoot, "recent-repos.json")
  ];
  for (const t of repoTargets) {
    try {
      if (fs.existsSync(t)) fs.writeFileSync(t, "[]\n", "utf8");
    } catch {}
  }

  console.log(`[CLEAN] Marked ${ids.length} old sessions as deleted in local directory section.`);
} catch (err) {
  console.warn("[CLEAN] Could not query remote sessions:", err.message);
}
'

echo "--------------------------------------------------------"
echo "Purged $PURGED_DIRS temporary session directories"
echo "Purged $PURGED_FILES temporary files & caches"
echo "Session cleanup completed successfully ✓"
echo "========================================================"
