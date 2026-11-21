#!/usr/bin/env bash
# Build the volunteer release tarball into releases/ and print its sha256 so
# volunteers can verify the file they were handed. Nothing is published.
set -euo pipefail
cd "$(dirname "$0")/.." # the package root (npm run already sets cwd there)
npm run build
mkdir -p ../releases
npm pack --pack-destination ../releases > /dev/null
TGZ="../releases/uipocalypse-$(node -p "require('./package.json').version").tgz"
echo "built: $TGZ"
sha256sum "$TGZ"
python3 ../scripts/presend-scan.py "$TGZ"
