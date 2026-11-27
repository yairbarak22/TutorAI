#!/bin/sh
# TutorAI Local installer for macOS and Linux.
#   curl -fsSL https://yairbarak22.github.io/TutorAI/install.sh | sh
# Downloads the TutorAI binary for this computer from the latest GitHub Release, checks it
# against the release's SHA256SUMS, installs it to ~/.local/bin/tutorai, adds a TutorAI icon,
# and opens TutorAI. Nothing runs as root. Uninstall: tutorai uninstall
set -eu

REPO="yairbarak22/TutorAI"
BASE="${TUTORAI_RELEASE_BASE:-https://github.com/$REPO/releases/latest/download}"
BIN_DIR="$HOME/.local/bin"
BIN="$BIN_DIR/tutorai"

say() { printf '%s\n' "$*"; }
fail() { printf 'TutorAI install failed: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux) OS=linux ;;
  *) fail "this installer is for macOS and Linux (on Windows use install.ps1)" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) fail "unsupported processor: $(uname -m)" ;;
esac
# Apple Silicon Macs running this shell under Rosetta still get the native build.
if [ "$OS" = macos ] && [ "$ARCH" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then ARCH=arm64; fi
ASSET="tutorai-$OS-$ARCH"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

say "Downloading TutorAI ($OS, $ARCH)…"
fetch() {
  case "$1" in file://*) curl -fsSL -o "$2" "$1" || fail "could not read $1"; return ;; esac # local test releases
  # Retry dropped connections too (unstable Wi-Fi), where this curl supports it (7.71+).
  retry="--retry 5 --retry-delay 2"
  curl --help all 2>/dev/null | grep -q -- --retry-all-errors && retry="$retry --retry-all-errors"
  rc=0
  # shellcheck disable=SC2086
  code="$(curl -sSL $retry --connect-timeout 20 -w '%{http_code}' -o "$2" "$1")" || rc=$?
  if [ "$code" = 404 ]; then fail "no TutorAI release for $ASSET was found yet. Use the browser version for now: https://yairbarak22.github.io/TutorAI/"; fi
  if [ "$rc" -ne 0 ] || [ "$code" != 200 ]; then
    case "$code" in
      000|"") fail "couldn't reach GitHub. Check your internet connection and run the install line again." ;;
      200) fail "the download was interrupted. Check your internet connection and run the install line again." ;;
      *) fail "download failed (HTTP $code). Try again in a few minutes." ;;
    esac
  fi
}
fetch "$BASE/$ASSET" "$TMP/tutorai"
fetch "$BASE/SHA256SUMS" "$TMP/SHA256SUMS"

WANT="$(tr -d '\r' < "$TMP/SHA256SUMS" | awk -v a="$ASSET" '{ n = $2; sub(/^\*/, "", n); if (n == a) print $1 }')"
[ -n "$WANT" ] || fail "no checksum for $ASSET"
if command -v shasum >/dev/null 2>&1; then GOT="$(shasum -a 256 "$TMP/tutorai" | awk '{print $1}')"
else GOT="$(sha256sum "$TMP/tutorai" | awk '{print $1}')"; fi
[ "$WANT" = "$GOT" ] || fail "checksum mismatch; the download is not the published file"

# Stop a running TutorAI before replacing it.
[ -x "$BIN" ] && "$BIN" stop >/dev/null 2>&1 || true

mkdir -p "$BIN_DIR"
mv "$TMP/tutorai" "$BIN"
chmod 755 "$BIN"
if [ "$OS" = macos ]; then
  # Apple Silicon needs a signature; an ad-hoc one needs no Apple account.
  codesign --force --sign - "$BIN" >/dev/null 2>&1 || true
fi

# A TutorAI icon. Created on this computer, so macOS doesn't quarantine it.
if [ "$OS" = macos ]; then
  # The regular Applications folder (Launchpad, Spotlight, Finder) when we may write there; else ~/Applications.
  if [ -w /Applications ] && [ -z "${TUTORAI_USER_APPS:-}" ]; then APP="/Applications/TutorAI.app"; else APP="$HOME/Applications/TutorAI.app"; fi
  rm -rf "$APP"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>TutorAI</string>
  <key>CFBundleDisplayName</key><string>TutorAI</string>
  <key>CFBundleIdentifier</key><string>io.github.yairbarak22.tutorai</string>
  <key>CFBundleExecutable</key><string>TutorAI</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
  cat > "$APP/Contents/MacOS/TutorAI" <<LAUNCH
#!/bin/sh
exec "$BIN" open
LAUNCH
  chmod 755 "$APP/Contents/MacOS/TutorAI"
  curl -fsSL -o "$APP/Contents/Resources/icon.icns" "$BASE/icon.icns" 2>/dev/null || true
  say "Added TutorAI to Applications ($APP)."
else
  DESKTOP="$HOME/.local/share/applications/tutorai.desktop"
  mkdir -p "$(dirname "$DESKTOP")" "$HOME/.local/share/icons"
  curl -fsSL -o "$HOME/.local/share/icons/tutorai.png" "$BASE/icon.png" 2>/dev/null || true
  cat > "$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Name=TutorAI
Comment=AI study companion
Exec=$BIN open
Icon=$HOME/.local/share/icons/tutorai.png
Terminal=false
Categories=Education;
DESK
  say "Added TutorAI to your applications menu."
fi

# Make the tutorai command available in new terminals.
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
      if [ -f "$rc" ] && ! grep -q '.local/bin' "$rc"; then printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"; fi
    done
    ;;
esac

say ""
say "TutorAI is installed."
if [ "$OS" = macos ]; then
  say "  To open it later: press ⌘+Space, type TutorAI and press Enter (or open it from Launchpad / Applications)."
else
  say "  To open it later: TutorAI in your applications menu, or run: tutorai"
fi
say "  When you're done: just close the browser. TutorAI stops by itself after 15 minutes without use."
say "Opening TutorAI in your browser…"
[ "${TUTORAI_NO_OPEN:-}" = 1 ] || "$BIN" open || say "Open TutorAI from its icon."
