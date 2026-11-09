import { selectRasterizer } from '@termless/core'
import { describe, expect, it } from 'vitest'

import { optimizeSvg } from '../../lib/optimize-svg.mts'

const extractStyle = (svg: string) =>
  svg.match(/<style>([\s\S]*?)<\/style>/)?.[1]

describe('optimizeSvg', () => {
  it('shrinks terminal SVG without changing its rendered pixels or text layout', async () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48">
      <rect x="0" y="0" width="160" height="48" fill="#ffffff" />
      <text xml:space="preserve" x="8" y="24" font-family="JetBrains Mono, monospace" font-size="14" fill="#000000" stroke="rgb(12.5, 24.5, 60.5)"><tspan x="8"> first  </tspan><tspan x="44">second</tspan></text>
    </svg>`
    const optimized = optimizeSvg(source)
    expect(optimized.length).toBeLessThan(source.length)
    expect(optimized).toContain('xml:space="preserve"')
    expect(optimized).toContain('font-family="JetBrains Mono, monospace"')
    expect(optimized).toContain('fill="#fff"')
    expect(optimized).toContain('stroke="rgb(12.5, 24.5, 60.5)"')
    expect(optimized).toContain('<tspan x="8"> first  </tspan>')
    expect(optimized).toContain('<tspan x="44">second</tspan>')

    const rasterizer = await selectRasterizer('resvg')
    try {
      const [before, after] = await Promise.all([
        rasterizer.rasterize(source, 1),
        rasterizer.rasterize(optimized, 1),
      ])
      expect(after.width).toBe(before.width)
      expect(after.height).toBe(before.height)
      expect(Buffer.from(after.pixels).equals(Buffer.from(before.pixels))).toBe(
        true,
      )
    } finally {
      await rasterizer.dispose?.()
    }
  }, 30_000)

  it('preserves animation timing, frame classes, and embedded font CSS', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
      <style>
        @font-face { font-family: 'Terminal'; src: url(data:font/woff2;base64,AA==); }
        @keyframes f0 { 0% { opacity: 1 } 50% { opacity: 0 } }
        .f0 { animation: f0 2s steps(1) infinite; font-family: 'Terminal'; }
      </style>
      <g class="f0"><text>frame</text></g>
    </svg>`
    const optimized = optimizeSvg(source)
    expect(extractStyle(optimized)?.trim()).toBe(
      extractStyle(source)?.replaceAll("'", '&apos;').trim(),
    )
    expect(optimized).toContain('class="f0"')
    expect(optimized).toContain('animation: f0 2s steps(1) infinite')
    expect(optimized).toContain('font-family: &apos;Terminal&apos;')
  })
})
