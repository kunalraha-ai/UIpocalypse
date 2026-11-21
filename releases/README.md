# Releases

Volunteer handoff tarballs. NOT published anywhere — hand the file directly.

Current release: `uipocalypse-0.0.5.tgz`

- sha256: `fc3a95c92996cb2eb9f280a6d9ca864e199598a5cf119533c5cba97e66bdf033`
- Volunteers verify with: `sha256sum uipocalypse-0.0.5.tgz`
- Pre-send secret scan: 2 hits, both bundled-library artifacts (public
  GitHub SHAs in the MCP SDK's doc URLs, minified-code base64); no secrets,
  no home paths, no account identifiers. Since 0.0.5 the source map is
  stripped from the release (kept in dev builds), which also removed its
  scan-surface artifacts.

Regenerate: `cd uipocalypse && npm run release` (builds, strips the source
map, packs into `releases/`, prints the sha256, re-runs the pre-send scan).

Tarballs are gitignored on purpose — binaries stay out of git. (An earlier
0.0.2 tarball was committed by mistake; it contained no secrets — scan
verified — so history was not rewritten. It remains retrievable from history
and has been removed from the working tree.)
