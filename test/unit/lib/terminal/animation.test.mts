import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createTerminal, selectRasterizer } from '@termless/core'
import { createXtermBackend } from '@termless/xtermjs'
import { describe, expect, it, onTestFinished } from 'vitest'

import {
  assertSamePixels,
  captureCheckpoint,
  createBlankCell,
  createRecording,
  createTerminalAnimationSvg,
  emptyCell,
  expectTerminalAnimation,
  findLastOccupiedRow,
  isVisiblyOccupied,
  renderCaptured,
} from '../../../lib/terminal/animation.mts'

import type { AnimationFrame } from '@termless/core'

describe('terminal animation recorder', () => {
  it('repairs keyframe separators while preserving every frame and duration', () => {
    const frames: AnimationFrame[] = [
      {
        svg: '<svg width="2" height="2"><text>frame-one</text></svg>',
        duration: 100,
      },
      {
        svg: '<svg width="2" height="2"><text>frame-two</text></svg>',
        duration: 250,
      },
      {
        svg: '<svg width="2" height="2"><text>frame-three</text></svg>',
        duration: 400,
      },
    ]
    const svg = createTerminalAnimationSvg(frames)
    for (const text of ['frame-one', 'frame-two', 'frame-three']) {
      expect(svg).toContain(text)
    }
    expect(svg).toContain('f0 0.75s')
    expect(svg).toContain('f1 0.75s')
    expect(svg).toContain('f2 0.75s')
    const css = [...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map(match => match[1] ?? '')
      .find(style => style.includes('@keyframes'))
    expect(css).toBeDefined()
    expect(css).not.toMatch(/};\s*\d+(?:\.\d+)?%/)
    const keyframes = [
      ...css!.matchAll(/@keyframes f\d \{([\s\S]*?)\}\s*\.f\d \{/g),
    ]
    expect(keyframes).toHaveLength(3)
    for (const [, body] of keyframes) {
      expect(body).toMatch(/0% \{ opacity: [01] \}/)
      expect(body).toMatch(/\d+(?:\.\d+)?% \{ opacity: [01] \}/)
    }
  })

  it('detects visible cells and styled blank cells', () => {
    const blank = emptyCell()
    expect(isVisiblyOccupied(blank)).toBe(false)
    expect(isVisiblyOccupied({ ...blank, char: 'x' })).toBe(true)
    expect(isVisiblyOccupied({ ...blank, bg: { r: 1, g: 2, b: 3 } })).toBe(true)
    expect(isVisiblyOccupied({ ...blank, inverse: true })).toBe(true)
    expect(isVisiblyOccupied({ ...blank, underline: 'single' })).toBe(true)
  })

  it('creates neutral blank cells from styled templates', () => {
    const styled = {
      ...emptyCell(),
      char: 'x',
      fg: { r: 1, g: 2, b: 3 },
      bg: { r: 4, g: 5, b: 6 },
      bold: true,
      inverse: true,
      underline: 'double' as const,
      wide: true,
      continuation: true,
      hyperlink: 'https://example.invalid',
    }
    expect(createBlankCell(styled)).toEqual(emptyCell())
  })

  it('finds the last occupied row while preserving earlier blank rows', () => {
    const blank = emptyCell()
    const rows = [
      [{ ...blank, char: 'top' }],
      [blank],
      [{ ...blank, bg: { r: 1, g: 2, b: 3 } }],
      [blank],
    ]
    expect(findLastOccupiedRow(rows)).toBe(2)
    expect(findLastOccupiedRow([[], [blank]])).toBe(-1)
    expect(rows[1]?.every(cell => !isVisiblyOccupied(cell))).toBe(true)
  })

  it('renders a requested canvas height at fixed terminal width with neutral padding', () => {
    const cell = { ...emptyCell(), char: 'x' }
    const captured = {
      cols: 4,
      height: 1,
      rows: [[cell, ...Array.from({ length: 3 }, () => emptyCell())]],
      cursor: {
        col: 0,
        row: 0,
        x: 0,
        y: 0,
        visible: false,
        style: 'block' as const,
      },
    }
    const short = renderCaptured(captured, 1)
    const tall = renderCaptured(captured, 3)
    expect(svgSize(short).width).toBe(svgSize(tall).width)
    expect(svgSize(tall).height).toBeGreaterThan(svgSize(short).height)
    expect(tall).not.toContain('text-decoration="underline"')
  })

  it('trims empty rows after visible output and preserves internal blank rows', async () => {
    const terminal = createTerminal({
      cols: 20,
      rows: 14,
      backend: createXtermBackend(),
    })
    onTestFinished(async () => await terminal.close())
    terminal.feed('top\r\n\r\nbottom')
    const checkpoint = await captureCheckpoint(terminal, 'trimmed')
    expect(checkpoint.captured?.rows.length).toBe(5)
    expect(
      checkpoint.captured?.rows[0]?.map(cell => cell.char).join(''),
    ).toContain('top')
    expect(
      checkpoint.captured?.rows[1]?.every(
        cell => cell.char === '' || cell.char === ' ',
      ),
    ).toBe(true)
    expect(
      checkpoint.captured?.rows[2]?.map(cell => cell.char).join(''),
    ).toContain('bottom')
    expect(svgHeight(checkpoint.svg)).toBeLessThan(
      svgHeight(terminal.screenshotSvg({ fontSize: 14 })),
    )
  })

  it('retains styled blank rows, wide cells, and a visible cursor', async () => {
    const terminal = createTerminal({
      cols: 20,
      rows: 14,
      backend: createXtermBackend(),
    })
    onTestFinished(async () => await terminal.close())
    terminal.feed(
      'word\x1b[9;1H\x1b[44m \x1b[0m\x1b[11;1H😀\x1b[13;1H\x1b[?25h',
    )
    const checkpoint = await captureCheckpoint(terminal, 'decorated')
    expect(checkpoint.captured?.rows.length).toBe(14)
    expect(checkpoint.captured?.rows[8]?.some(cell => cell.bg !== null)).toBe(
      true,
    )
    const styledBlank = checkpoint.captured?.rows[8]?.find(
      cell => cell.bg !== null,
    )
    expect(Object.isFrozen(styledBlank?.bg)).toBe(true)
    expect(
      checkpoint.captured?.rows[10]?.some(
        cell => cell.wide || cell.continuation,
      ),
    ).toBe(true)
    expect(checkpoint.captured?.cursor.visible).toBe(true)
    expect(checkpoint.svg).not.toContain('text-decoration="underline"')
  })

  it('keeps two padding rows when the visible cursor is on the last screen row', async () => {
    const terminal = createTerminal({
      cols: 20,
      rows: 8,
      backend: createXtermBackend(),
    })
    onTestFinished(async () => await terminal.close())
    terminal.feed('\x1b[8;1H\x1b[?25h')
    const checkpoint = await captureCheckpoint(terminal, 'bottom-cursor')
    expect(checkpoint.captured?.height).toBe(10)
    expect(checkpoint.captured?.rows.length).toBe(8)
  })

  it('translates the visible cursor into absolute buffer coordinates after scrollback', async () => {
    const terminal = createTerminal({
      cols: 20,
      rows: 4,
      backend: createXtermBackend(),
    })
    onTestFinished(async () => await terminal.close())
    terminal.feed('one\r\ntwo\r\nthree\r\nfour\r\nfive')
    const checkpoint = await captureCheckpoint(terminal, 'scrolled-cursor')
    const scrollback = terminal.getScrollback()
    expect(checkpoint.captured?.cursor.row).toBe(
      scrollback.totalRows - scrollback.screenRows + terminal.getCursor().row,
    )
  })

  it('renders captured frames on a common trimmed canvas without mutating earlier captures', async () => {
    const terminal = createTerminal({
      cols: 20,
      rows: 16,
      backend: createXtermBackend(),
    })
    onTestFinished(async () => await terminal.close())
    terminal.feed('short')
    const first = await captureCheckpoint(terminal, 'first')
    const originalFirst = first.svg
    terminal.feed('\x1b[12;1Hlonger')
    const second = await captureCheckpoint(terminal, 'second')
    const recording = createRecording([first, second])
    expect(first.svg).toBe(originalFirst)
    expect(recording.checkpoints.map(frame => svgHeight(frame.svg))).toEqual([
      svgHeight(recording.checkpoints[1]!.svg),
      svgHeight(recording.checkpoints[1]!.svg),
    ])
    expect(svgHeight(recording.checkpoints[0]!.svg)).toBeGreaterThan(
      svgHeight(first.svg),
    )
    expect(recording.checkpoints[0]!.svg).not.toContain('longer')
    expect(recording.checkpoints[0]!.svg).toContain('short')
    expect(Object.isFrozen(first.captured?.rows[0])).toBe(true)
    expect(Object.isFrozen(first.captured?.rows[0]?.[0])).toBe(true)
  })

  it('rejects reordered or deleted checkpoints against the declared sequence', async () => {
    const scratchDir = await mkdtemp(
      path.join(os.tmpdir(), 'termless-regression-'),
    )
    onTestFinished(
      async () => await rm(scratchDir, { recursive: true, force: true }),
    )
    const recording = createRecording([
      {
        name: 'first',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      },
      {
        name: 'second',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      },
    ])

    await expect(
      expectTerminalAnimation(recording, {
        flow: 'regression',
        snapshotsDir: path.join(scratchDir, 'snapshots'),
        artifactsDir: path.join(scratchDir, 'artifacts'),
        expectedSequence: ['second', 'first'],
      }),
    ).rejects.toThrow('Checkpoint sequence mismatch')
    await expect(
      expectTerminalAnimation(createRecording([recording.checkpoints[0]!]), {
        flow: 'regression',
        snapshotsDir: path.join(scratchDir, 'snapshots'),
        artifactsDir: path.join(scratchDir, 'artifacts'),
        expectedSequence: ['first', 'second'],
      }),
    ).rejects.toThrow('Checkpoint sequence mismatch')
    // The first resvg use may load the bundled font inventory on Windows.
  }, 30_000)

  it('copies and freezes checkpoints when creating a recording', () => {
    const source = {
      name: 'first',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
    }
    const recording = createRecording([source])
    source.svg = '<svg>mutated</svg>'
    expect(recording.checkpoints[0]?.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
    )
    expect(Object.isFrozen(recording.checkpoints[0])).toBe(true)
    expect(Object.isFrozen(recording.checkpoints)).toBe(true)
  })

  it('rejects a real raster pixel change', async () => {
    const rasterizer = await selectRasterizer('resvg')
    try {
      await assertSamePixels(
        rasterizer,
        colorSvg('#ff0000'),
        colorSvg('#ff0000'),
      )
      await expect(
        assertSamePixels(rasterizer, colorSvg('#ff0000'), colorSvg('#0000ff')),
      ).rejects.toThrow('Terminal screenshot pixels differ')
    } finally {
      await rasterizer.dispose?.()
    }
  }, 30_000)
})

function svgHeight(svg: string): number {
  const match = /height="([\d.]+)/.exec(svg)
  if (!match) {
    throw new Error('SVG has no height')
  }
  return Number(match[1])
}

function svgSize(svg: string): { width: number; height: number } {
  const match = /width="([\d.]+)" height="([\d.]+)"/.exec(svg)
  if (!match) {
    throw new Error('SVG has no size')
  }
  return { width: Number(match[1]), height: Number(match[2]) }
}

function colorSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="${color}"/></svg>`
}
