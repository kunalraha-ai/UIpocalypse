# Releases

Volunteer handoff tarballs. NOT published anywhere — hand the file directly.

Current release: `uipocalypse-0.0.3.tgz`

- sha256: `184bb9e2d4000e8b54a3fb6d298000148c6e79d3b42fea15a7f4e8bbce694f7d`
- Volunteers verify with: `sha256sum uipocalypse-0.0.3.tgz`
- Pre-send secret scan: clean (only bundled-library artifacts: public GitHub
  SHAs in the MCP SDK's doc URLs, minified-code base64; no secrets, no home
  paths, no account identifiers)

Regenerate: `cd uipocalypse && npm run release` (builds, packs into
`releases/`, prints the sha256, and re-runs the pre-send scan).

Tarballs are gitignored on purpose — binaries stay out of git. (An earlier
0.0.2 tarball was committed by mistake; it contained no secrets — scan
verified — so history was not rewritten. It remains retrievable from history
and has been removed from the working tree.)
