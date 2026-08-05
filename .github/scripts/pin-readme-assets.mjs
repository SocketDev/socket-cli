// Registry pages (npmjs.com) render the README from the published tarball,
// where relative `assets/…` refs 404 — they only resolve when viewing the
// repo on GitHub. Rewrite them to the release tag's raw-GitHub URL before the
// packs, so every variant ships absolute, immutable asset URLs. The CI
// workspace is ephemeral, so no restore pass is needed. Mirrors
// socket-wheelhouse's publish-infra pin-readme pass (src, srcset, and
// markdown ref forms; absolute refs are untouched and the rewrite is
// idempotent — an already-absolute ref has no leading `assets/` to match).
import { readFileSync, writeFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const base = `https://raw.githubusercontent.com/SocketDev/socket-cli/v${version}/`
const readme = readFileSync('README.md', 'utf8')
const pinned = readme
  .replaceAll('src="assets/', `src="${base}assets/`)
  .replaceAll('srcset="assets/', `srcset="${base}assets/`)
  .replaceAll('](assets/', `](${base}assets/`)
if (pinned === readme) {
  console.log('pin-readme-assets: no relative assets/ refs to pin')
} else {
  writeFileSync('README.md', pinned)
  console.log(`pin-readme-assets: pinned relative assets/ refs to ${base}`)
}
