#!/usr/bin/env bash
# Install a pinned gitleaks release binary into <dir>, verified against its SHA-256 (SEC-51).
#   .github/scripts/install-gitleaks.sh <dir>
# Bumping: change VERSION and the three checksums, copied from the release's gitleaks_<v>_checksums.txt.
set -euo pipefail
DIR="${1:?install dir}"
VERSION=8.30.1
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)                ASSET="linux_x64.tar.gz";    SHA=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  Darwin-arm64)                ASSET="darwin_arm64.tar.gz"; SHA=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  MINGW*-x86_64|MSYS*-x86_64)  ASSET="windows_x64.zip";     SHA=d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e ;;
  *) echo "install-gitleaks: no pinned checksum for $(uname -s)-$(uname -m)"; exit 1 ;;
esac
FILE="gitleaks_${VERSION}_${ASSET}"
mkdir -p "$DIR"
curl -fsSL --retry 3 -o "$DIR/$FILE" "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${FILE}"
# Hash stdin, not a path: GNU sha256sum prefixes its line with `\` when the path holds a
# backslash (Windows $RUNNER_TEMP), which would break the strict compare below.
if command -v sha256sum >/dev/null 2>&1; then GOT=$(sha256sum < "$DIR/$FILE" | cut -d' ' -f1)
else GOT=$(shasum -a 256 < "$DIR/$FILE" | cut -d' ' -f1); fi
if [ "$GOT" != "$SHA" ]; then
  echo "install-gitleaks: checksum mismatch for $FILE (expected $SHA, got $GOT)"; rm -f "$DIR/$FILE"; exit 1
fi
case "$ASSET" in
  *.zip) unzip -oq "$DIR/$FILE" gitleaks.exe -d "$DIR" ;;
  *) tar -xzf "$DIR/$FILE" -C "$DIR" gitleaks ;;
esac
rm -f "$DIR/$FILE"
"$DIR/gitleaks" version
