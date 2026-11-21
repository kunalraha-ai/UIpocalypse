#!/usr/bin/env bash
# Build the volunteer release tarball into releases/ and print its sha256 so
# volunteers can verify the file they were handed. Nothing is published.
set -euo pipefail
cd "$(dirname "$0")/.." # the package root (npm run sets cwd there already)
npm run build
# The source map ships in dev builds but NOT in the volunteer tarball: it is
# 6 MB of build artifacts the tool never needs at runtime, and the leaner the
# release, the smaller the pre-send scan surface. (index.cjs keeps a dangling
# sourceMappingURL comment — devtools ignore the 404 silently.)
rm -f dist/index.cjs.map
mkdir -p ../releases
npm pack --pack-destination ../releases > /dev/null
TGZ="../releases/uipocalypse-$(node -p "require('./package.json').version").tgz"
echo "built: $TGZ"
sha256sum "$TGZ"
python3 ../scripts/presend-scan.py "$TGZ"
