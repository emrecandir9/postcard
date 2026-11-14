#!/bin/bash
# Builds "Field Notes Postcard.app" in ~/Applications.
# Clicking the app starts the local server (if it is not already running) and opens the site.
# Re-run this script if the project folder moves.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
APP="$HOME/Applications/Field Notes Postcard.app"
PORT=3000

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Field Notes Postcard</string>
  <key>CFBundleIdentifier</key><string>local.fieldnotes.postcard</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF

cat > "$APP/Contents/MacOS/launch" <<EOF
#!/bin/bash
# Starts the postcard server if nothing is listening on the port, then opens the site.
export PATH="$(dirname "$NODE"):\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
URL="http://localhost:$PORT"
LOG="\$HOME/Library/Logs/field-notes-postcard.log"
# A server started before the code last changed is still running the old code: stop it so a fresh
# one starts below. Only this project's own "node server.js" is ever stopped.
PID=\$(/usr/sbin/lsof -ti :$PORT -sTCP:LISTEN | head -1)
if [ -n "\$PID" ] && /usr/sbin/lsof -a -p "\$PID" -d cwd -Fn | grep -qx "n$PROJECT" && ps -o command= -p "\$PID" | grep -q "server.js"; then
  STARTED=\$(date -j -f "%a %b %d %T %Y" "\$(LC_ALL=C ps -o lstart= -p "\$PID")" +%s 2>/dev/null || echo 0)
  NEWEST=\$(cd "$PROJECT" && find server.js lib shared package.json -type f -exec stat -f %m {} + | sort -n | tail -1)
  if [ "\${NEWEST:-0}" -gt "\$STARTED" ]; then
    kill "\$PID"
    for i in \$(seq 1 20); do /usr/sbin/lsof -ti :$PORT -sTCP:LISTEN >/dev/null || break; sleep 0.25; done
  fi
fi
if ! /usr/bin/curl -s -o /dev/null --max-time 1 "\$URL/api/config"; then
  cd "$PROJECT" || { /usr/bin/osascript -e 'display alert "Field Notes Postcard" message "The project folder was not found. Run scripts/make-mac-app.sh again."'; exit 1; }
  PORT=$PORT nohup "$NODE" server.js >> "\$LOG" 2>&1 &
  for i in \$(seq 1 40); do
    /usr/bin/curl -s -o /dev/null --max-time 1 "\$URL/api/config" && break
    sleep 0.25
  done
fi
/usr/bin/open "\$URL"
EOF
chmod +x "$APP/Contents/MacOS/launch"

# Icon: a small postcard (photo on top, paper with a stamp below) on a cream tile.
TMP="$(mktemp -d)"
cat > "$TMP/icon.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="64" y="64" width="896" height="896" rx="200" fill="#faf2ec"/>
  <g transform="rotate(-4 512 512)">
    <rect x="232" y="212" width="560" height="600" fill="#1b1917" opacity=".12" transform="translate(10 14)"/>
    <rect x="232" y="212" width="560" height="340" fill="#7fa3c7"/>
    <circle cx="664" cy="312" r="44" fill="#f3d9a4"/>
    <path d="M232 552L420 330l120 140 80-90 172 172z" fill="#4f6b58"/>
    <rect x="232" y="552" width="560" height="260" fill="#eae0ca"/>
    <rect x="282" y="602" width="170" height="160" fill="none" stroke="#a8452e" stroke-width="12" stroke-dasharray="26 18"/>
    <path d="M312 732l52-70 36 44 24-30 40 56z" fill="#a8452e"/>
    <rect x="500" y="630" width="230" height="26" fill="#3a342c"/>
    <rect x="500" y="684" width="170" height="16" fill="#3a342c" opacity=".6"/>
    <rect x="500" y="722" width="120" height="16" fill="#3a342c" opacity=".6"/>
  </g>
</svg>
EOF
mkdir "$TMP/icon.iconset"
(cd "$PROJECT" && "$NODE" -e "
const sharp = require('sharp');
const [svg, out] = process.argv.slice(1);
const sizes = [16, 32, 64, 128, 256, 512, 1024];
Promise.all(sizes.map((s) => sharp(svg, { density: 300 }).resize(s, s).png().toFile(out + '/' + s + '.png')));
" "$TMP/icon.svg" "$TMP")
for s in 16 32 128 256 512; do
  cp "$TMP/$s.png" "$TMP/icon.iconset/icon_${s}x${s}.png"
  cp "$TMP/$((s * 2)).png" "$TMP/icon.iconset/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$TMP/icon.iconset" -o "$APP/Contents/Resources/icon.icns"
rm -rf "$TMP"
touch "$APP"
echo "Built: $APP"
