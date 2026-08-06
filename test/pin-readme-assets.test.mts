import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = path.join(
  rootPath,
  '.github',
  'scripts',
  'pin-readme-assets.mjs',
)

const tempDirs: string[] = []

function stageWorkspace(options: {
  readme: string
  version?: string | undefined
}): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pin-readme-assets-'))
  tempDirs.push(dir)
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'socket', version: options.version ?? '1.2.3' }),
  )
  writeFileSync(path.join(dir, 'README.md'), options.readme)
  return dir
}

function runPin(cwd: string): { status: number | null; stdout: string } {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout }
}

function readmeIn(dir: string): string {
  return readFileSync(path.join(dir, 'README.md'), 'utf8')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

// Registry pages (npmjs.com) render the README from the published tarball,
// where relative assets/ refs 404 — they only resolve when browsing the repo
// on GitHub. The publish workflow runs this script once before packing so
// every variant ships absolute raw-GitHub URLs pinned to the release tag.
describe('pin-readme-assets', () => {
  const base = 'https://raw.githubusercontent.com/SocketDev/socket-cli/v1.2.3/'

  it('pins a relative img src to the release tag raw URL', () => {
    const dir = stageWorkspace({
      readme: '<img src="assets/logo.png" alt="logo">\n',
    })
    const { status } = runPin(dir)
    expect(status).toBe(0)
    expect(readmeIn(dir)).toBe(
      `<img src="${base}assets/logo.png" alt="logo">\n`,
    )
  })

  it('pins a relative srcset ref', () => {
    const dir = stageWorkspace({
      readme:
        '<source srcset="assets/dark.png" media="(prefers-color-scheme: dark)">\n',
    })
    runPin(dir)
    expect(readmeIn(dir)).toBe(
      `<source srcset="${base}assets/dark.png" media="(prefers-color-scheme: dark)">\n`,
    )
  })

  it('pins a markdown image ref', () => {
    const dir = stageWorkspace({
      readme: '![banner](assets/banner.png)\n',
    })
    runPin(dir)
    expect(readmeIn(dir)).toBe(`![banner](${base}assets/banner.png)\n`)
  })

  it('reads the tag from package.json version', () => {
    const dir = stageWorkspace({
      readme: '![banner](assets/banner.png)\n',
      version: '9.9.9',
    })
    runPin(dir)
    expect(readmeIn(dir)).toContain(
      'https://raw.githubusercontent.com/SocketDev/socket-cli/v9.9.9/assets/banner.png',
    )
  })

  it('leaves absolute refs untouched', () => {
    const readme =
      '<img src="https://example.com/assets/logo.png">\n' +
      '![ext](https://example.com/assets/banner.png)\n'
    const dir = stageWorkspace({ readme })
    const { status, stdout } = runPin(dir)
    expect(status).toBe(0)
    expect(readmeIn(dir)).toBe(readme)
    expect(stdout).toContain('no relative assets/ refs to pin')
  })

  it('is idempotent — a second run changes nothing', () => {
    const dir = stageWorkspace({
      readme:
        '<img src="assets/logo.png">\n' +
        '<source srcset="assets/dark.png">\n' +
        '![banner](assets/banner.png)\n',
    })
    runPin(dir)
    const afterFirst = readmeIn(dir)
    const { status, stdout } = runPin(dir)
    expect(status).toBe(0)
    expect(readmeIn(dir)).toBe(afterFirst)
    expect(stdout).toContain('no relative assets/ refs to pin')
  })

  it('pins a reference-style definition', () => {
    const dir = stageWorkspace({
      readme: '![banner][banner-ref]\n\n[banner-ref]: assets/banner.png\n',
    })
    const { status } = runPin(dir)
    expect(status).toBe(0)
    expect(readmeIn(dir)).toBe(
      `![banner][banner-ref]\n\n[banner-ref]: ${base}assets/banner.png\n`,
    )
  })

  it('pins refs inside blockquotes and list items', () => {
    const dir = stageWorkspace({
      readme:
        '> ![quoted](assets/quoted.png)\n' +
        '\n' +
        '- [download](assets/file.pdf)\n',
    })
    runPin(dir)
    expect(readmeIn(dir)).toBe(
      `> ![quoted](${base}assets/quoted.png)\n` +
        '\n' +
        `- [download](${base}assets/file.pdf)\n`,
    )
  })

  it('leaves assets/ refs inside fenced code blocks alone', () => {
    const readme =
      '```md\n' +
      '![example](assets/example.png)\n' +
      '<img src="assets/example.png">\n' +
      '```\n'
    const dir = stageWorkspace({ readme })
    const { status, stdout } = runPin(dir)
    expect(status).toBe(0)
    expect(readmeIn(dir)).toBe(readme)
    expect(stdout).toContain('no relative assets/ refs to pin')
  })

  it('leaves assets/ refs inside inline code spans alone', () => {
    const readme = 'Point refs like `](assets/x.png)` at the release tag.\n'
    const dir = stageWorkspace({ readme })
    const { status, stdout } = runPin(dir)
    expect(status).toBe(0)
    expect(readmeIn(dir)).toBe(readme)
    expect(stdout).toContain('no relative assets/ refs to pin')
  })

  it('pins real refs while leaving code-block lookalikes alone', () => {
    const dir = stageWorkspace({
      readme:
        '![banner](assets/banner.png)\n' +
        '\n' +
        '```html\n' +
        '<img src="assets/banner.png">\n' +
        '```\n',
    })
    const { status } = runPin(dir)
    expect(status).toBe(0)
    expect(readmeIn(dir)).toBe(
      `![banner](${base}assets/banner.png)\n` +
        '\n' +
        '```html\n' +
        '<img src="assets/banner.png">\n' +
        '```\n',
    )
  })

  it('pins every ref form in one pass and reports the base', () => {
    const dir = stageWorkspace({
      readme:
        '<picture>\n' +
        '  <source srcset="assets/dark.png" media="(prefers-color-scheme: dark)">\n' +
        '  <img src="assets/light.png" alt="Socket CLI">\n' +
        '</picture>\n' +
        '\n' +
        'See ![the flow](assets/flow.png) for details.\n',
    })
    const { status, stdout } = runPin(dir)
    expect(status).toBe(0)
    expect(stdout).toContain(`pinned relative assets/ refs to ${base}`)
    const pinned = readmeIn(dir)
    expect(pinned).not.toContain('"assets/')
    expect(pinned).not.toContain('](assets/')
    expect(pinned).toContain(`src="${base}assets/light.png"`)
    expect(pinned).toContain(`srcset="${base}assets/dark.png"`)
    expect(pinned).toContain(`](${base}assets/flow.png)`)
  })
})
