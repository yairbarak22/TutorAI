#!/bin/sh
# Makes the launcher icons from apps/web/public/icon.svg (run on macOS: Quick Look renders the
# SVG; sips/iconutil make the .icns; Python writes a PNG-based .ico). Output: apps/local/out/
set -eu
cd "$(dirname "$0")/../../.."
OUT=apps/local/out
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
qlmanage -t -s 1024 -o "$TMP" apps/web/public/icon.svg >/dev/null 2>&1
SRC="$TMP/icon.svg.png"
[ -f "$SRC" ] || { echo "could not render icon.svg" >&2; exit 1; }
sips -z 512 512 "$SRC" --out "$OUT/icon.png" >/dev/null
SET="$TMP/icon.iconset"
mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); sips -z $d $d "$SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$OUT/icon.icns"
# .ico with one 256x256 PNG entry (supported since Windows Vista).
sips -z 256 256 "$SRC" --out "$TMP/256.png" >/dev/null
python3 - "$TMP/256.png" "$OUT/icon.ico" <<'PY'
import struct, sys
png = open(sys.argv[1], "rb").read()
header = struct.pack("<HHH", 0, 1, 1)
entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 6 + 16)
open(sys.argv[2], "wb").write(header + entry + png)
PY
ls -la "$OUT"/icon.*
