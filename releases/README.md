# Releases

Volunteer handoff tarballs. NOT published anywhere — hand the file directly.

Current release: `uipocalypse-0.0.4.tgz`

- sha256: `7491c9f9e330b2579b19a80ae0348cffc0ef3857c693357027e5e8808d97514e`
- Volunteers verify with: `sha256sum uipocalypse-0.0.4.tgz`
- Pre-send secret scan: clean (only bundled-library artifacts: public GitHub
  SHAs in the MCP SDK's doc URLs, minified-code base64; no secrets, no home
  paths, no account identifiers)

Regenerate: `cd uipocalypse && npm run release` (builds, packs into
`releases/`, prints the sha256, and re-runs the pre-send scan).

Tarballs are gitignored on purpose — binaries stay out of git. (An earlier
0.0.2 tarball was committed by mistake; it contained no secrets — scan
verified — so history was not rewritten. It remains retrievable from history
and has been removed from the working tree.)
