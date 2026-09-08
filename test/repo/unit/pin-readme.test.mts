/**
 * @file Behavior coverage for the publish-time README asset pin
 *   (`scripts/fleet/registry-infra/pin-readme.mts`). `pinReadmeAssets` parses
 *   the README to a position-tracked GFM mdast tree and derives every edit
 *   from parser-reported byte offsets (raw HTML goes through parse5 with
 *   source locations), so a relative `assets/` ref is pinned wherever it is a
 *   real ref — markdown image/link/definition, `src`/`srcset` attribute —
 *   and never where it is content (fenced code blocks, inline code spans).
 */
import { describe, expect, it } from 'vitest'

import { pinReadmeAssets } from '../../../scripts/fleet/registry-infra/pin-readme.mts'

const slug = 'SocketDev/socket-cli'
const ref = '0123456789abcdef0123456789abcdef01234567'
const base = `https://raw.githubusercontent.com/${slug}/${ref}/`

describe('pinReadmeAssets', () => {
  it('pins a relative img src', () => {
    expect(
      pinReadmeAssets('<img src="assets/logo.png" alt="logo">\n', slug, ref),
    ).toBe(`<img src="${base}assets/logo.png" alt="logo">\n`)
  })

  it('pins a relative srcset', () => {
    expect(
      pinReadmeAssets(
        '<source srcset="assets/dark.png" media="(prefers-color-scheme: dark)">\n',
        slug,
        ref,
      ),
    ).toBe(
      `<source srcset="${base}assets/dark.png" media="(prefers-color-scheme: dark)">\n`,
    )
  })

  it('pins a markdown image ref', () => {
    expect(pinReadmeAssets('![banner](assets/banner.png)\n', slug, ref)).toBe(
      `![banner](${base}assets/banner.png)\n`,
    )
  })

  it('pins a markdown link ref', () => {
    expect(pinReadmeAssets('[download](assets/file.pdf)\n', slug, ref)).toBe(
      `[download](${base}assets/file.pdf)\n`,
    )
  })

  it('pins a reference-style definition', () => {
    expect(
      pinReadmeAssets(
        '![banner][ref]\n\n[ref]: assets/banner.png\n',
        slug,
        ref,
      ),
    ).toBe(`![banner][ref]\n\n[ref]: ${base}assets/banner.png\n`)
  })

  it('pins refs inside blockquotes and list items', () => {
    expect(
      pinReadmeAssets(
        '> ![quoted](assets/quoted.png)\n\n- [download](assets/file.pdf)\n',
        slug,
        ref,
      ),
    ).toBe(
      `> ![quoted](${base}assets/quoted.png)\n\n- [download](${base}assets/file.pdf)\n`,
    )
  })

  it('pins refs inside GFM tables and footnotes', () => {
    const pinned = pinReadmeAssets(
      '| Logo | Name |\n' +
        '| --- | --- |\n' +
        '| ![logo](assets/logo.png) | Socket |\n' +
        '\n' +
        'See the screenshot.[^shot]\n' +
        '\n' +
        '[^shot]: ![shot](assets/shot.png)\n',
      slug,
      ref,
    )
    expect(pinned).toContain(`| ![logo](${base}assets/logo.png) | Socket |`)
    expect(pinned).toContain(`[^shot]: ![shot](${base}assets/shot.png)`)
  })

  it('leaves absolute refs untouched and returns the input byte-identical', () => {
    const readme =
      '<img src="https://example.com/assets/logo.png">\n' +
      '![ext](https://example.com/assets/banner.png)\n'
    expect(pinReadmeAssets(readme, slug, ref)).toBe(readme)
  })

  it('is idempotent — pinning a pinned README changes nothing', () => {
    const readme =
      '<img src="assets/logo.png">\n' +
      '<source srcset="assets/dark.png">\n' +
      '![banner](assets/banner.png)\n'
    const once = pinReadmeAssets(readme, slug, ref)
    expect(pinReadmeAssets(once, slug, ref)).toBe(once)
  })

  it('leaves assets/ refs inside fenced code blocks alone', () => {
    const readme =
      '```md\n![example](assets/example.png)\n<img src="assets/example.png">\n```\n'
    expect(pinReadmeAssets(readme, slug, ref)).toBe(readme)
  })

  it('leaves assets/ refs inside inline code spans alone', () => {
    const readme = 'Point refs like `](assets/x.png)` at the release sha.\n'
    expect(pinReadmeAssets(readme, slug, ref)).toBe(readme)
  })

  it('pins real refs while leaving code-block lookalikes alone', () => {
    expect(
      pinReadmeAssets(
        '![banner](assets/banner.png)\n\n```html\n<img src="assets/banner.png">\n```\n',
        slug,
        ref,
      ),
    ).toBe(
      `![banner](${base}assets/banner.png)\n\n` +
        '```html\n<img src="assets/banner.png">\n```\n',
    )
  })

  it('pins every ref form in one pass', () => {
    const pinned = pinReadmeAssets(
      '<picture>\n' +
        '  <source srcset="assets/dark.png" media="(prefers-color-scheme: dark)">\n' +
        '  <img src="assets/light.png" alt="Socket CLI">\n' +
        '</picture>\n' +
        '\n' +
        'See ![the flow](assets/flow.png) for details.\n',
      slug,
      ref,
    )
    expect(pinned).not.toContain('"assets/')
    expect(pinned).not.toContain('](assets/')
    expect(pinned).toContain(`src="${base}assets/light.png"`)
    expect(pinned).toContain(`srcset="${base}assets/dark.png"`)
    expect(pinned).toContain(`](${base}assets/flow.png)`)
  })
})
