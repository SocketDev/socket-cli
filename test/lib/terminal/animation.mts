import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  createAnimatedSvg,
  screenshotSvg,
  selectRasterizer,
} from '@termless/core'
import { expect } from 'vitest'

import { optimizeSvg } from '../optimize-svg.mts'

import type {
  AnimationFrame,
  AnimationOptions,
  Cell,
  Cursor,
  TestTerminal,
} from '@termless/core'

export interface Checkpoint {
  readonly name: string
  readonly svg: string
  readonly captured?: CapturedCheckpoint
}

export interface CapturedCheckpoint {
  readonly cols: number
  readonly height: number
  readonly rows: ReadonlyArray<readonly Cell[]>
  readonly cursor: Cursor
}

export interface TerminalRecording {
  readonly checkpoints: readonly Checkpoint[]
}

export interface RecordingOptions {
  readonly flow: string
  readonly snapshotsDir: string
  readonly artifactsDir: string
  readonly durations?: readonly number[]
  readonly expectedSequence: readonly string[]
}

export async function assertSamePixels(
  rasterizer: Awaited<ReturnType<typeof selectRasterizer>>,
  expectedSvg: string,
  actualSvg: string,
): Promise<void> {
  const [expected, actual] = await Promise.all([
    rasterizer.rasterize(expectedSvg, 1),
    rasterizer.rasterize(actualSvg, 1),
  ])
  if (
    expected.width !== actual.width ||
    expected.height !== actual.height ||
    !Buffer.from(expected.pixels).equals(Buffer.from(actual.pixels))
  ) {
    const expectedHash = createHash('sha256')
      .update(Buffer.from(expected.pixels))
      .digest('hex')
    const actualHash = createHash('sha256')
      .update(Buffer.from(actual.pixels))
      .digest('hex')
    throw new Error(
      `Terminal screenshot pixels differ (${expected.width}x${expected.height}, ${expectedHash} vs ${actual.width}x${actual.height}, ${actualHash})`,
    )
  }
}

const safeName = /^[a-z0-9][a-z0-9-]*$/
const svgOptions = {
  fontFamily: "'JetBrains Mono', 'Noto Sans Symbols 2', monospace",
  fontSize: 14,
  padding: 16,
  borderRadius: 8,
  windowBar: 'colorful' as const,
}

export async function captureCheckpoint(
  terminal: TestTerminal,
  name: string,
): Promise<Checkpoint> {
  if (!safeName.test(name)) {
    throw new Error(`Unsafe checkpoint name: ${name}`)
  }
  const rows = structuredClone(terminal.getRows())
  const cursor = structuredClone(terminal.getCursor())
  const scrollbackRows = Math.max(
    0,
    terminal.getScrollback().totalRows - terminal.getScrollback().screenRows,
  )
  const cursorRow = cursor.row + scrollbackRows
  const lastOccupied = findLastOccupiedRow(rows)
  const contentEnd = Math.max(
    lastOccupied,
    cursor.visible === true ? cursorRow : -1,
  )
  const height = Math.max(1, contentEnd + 3)
  const capturedRows = rows.slice(0, height).map(row =>
    Object.freeze(
      row.map(cell =>
        Object.freeze({
          ...cell,
          fg: cell.fg ? Object.freeze({ ...cell.fg }) : null,
          bg: cell.bg ? Object.freeze({ ...cell.bg }) : null,
          underlineColor: cell.underlineColor
            ? Object.freeze({ ...cell.underlineColor })
            : null,
        }),
      ),
    ),
  )
  const captured = Object.freeze({
    cols: terminal.cols,
    height,
    rows: Object.freeze(capturedRows),
    cursor: Object.freeze({ ...cursor, row: cursorRow, y: cursorRow }),
  })
  const svg = renderCaptured(captured, height)
  return Object.freeze({ name, svg, captured })
}

export function isVisiblyOccupied(cell: Cell): boolean {
  return (
    (cell.char !== '' && cell.char !== ' ') ||
    cell.bg !== null ||
    cell.inverse ||
    (cell.underline !== false && cell.underline !== 'none') ||
    cell.strikethrough === true ||
    cell.overline === true ||
    cell.wide ||
    cell.continuation
  )
}

export function createBlankCell(cell?: Cell): Cell {
  const template = cell ?? emptyCell()
  return {
    ...template,
    char: '',
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    underlineColor: null,
    strikethrough: false,
    inverse: false,
    blink: false,
    overline: false,
    hidden: false,
    wide: false,
    continuation: false,
    hyperlink: null,
  }
}

export function findLastOccupiedRow(
  rows: ReadonlyArray<readonly Cell[]>,
): number {
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index]!.some(isVisiblyOccupied)) {
      return index
    }
  }
  return -1
}

export function renderCaptured(
  captured: CapturedCheckpoint,
  height: number,
): string {
  const rows = captured.rows.slice(0, height).map(row => [...row])
  const blank = createBlankCell(rows[0]?.[0])
  while (rows.length < height) {
    rows.push(Array.from({ length: captured.cols }, () => ({ ...blank })))
  }
  const cursor = { ...captured.cursor }
  const virtualTerminal = {
    getRows: () => rows,
    getCursor: () => cursor,
  }
  return screenshotSvg(virtualTerminal as TestTerminal, svgOptions)
}

// Pinned Termless 0.11.0 separates keyframe blocks with invalid semicolons,
// which browsers use to discard later frames; repair only that generated CSS.
export function createTerminalAnimationSvg(
  frames: AnimationFrame[],
  options?: AnimationOptions,
): string {
  const svg = createAnimatedSvg(frames, options)
  return optimizeSvg(
    svg.replace(/<style>([\s\S]*?)<\/style>/g, (styleBlock, css: string) => {
      if (!css.includes('@keyframes')) {
        return styleBlock
      }
      return `<style>${css.replace(/};\s*(?=\d+(?:\.\d+)?%\s*\{)/g, '} ')}</style>`
    }),
  )
}

export function emptyCell(): Cell {
  return {
    char: '',
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    underlineColor: null,
    strikethrough: false,
    inverse: false,
    blink: false,
    overline: false,
    hidden: false,
    wide: false,
    continuation: false,
    hyperlink: null,
  }
}

export function createRecording(
  checkpoints: readonly Checkpoint[],
): TerminalRecording {
  if (checkpoints.length === 0) {
    throw new Error('Recording needs a checkpoint')
  }
  const seen = new Set<string>()
  const frozen: Checkpoint[] = []
  for (const checkpoint of checkpoints) {
    if (!safeName.test(checkpoint.name)) {
      throw new Error(`Unsafe checkpoint name: ${checkpoint.name}`)
    }
    if (seen.has(checkpoint.name)) {
      throw new Error(`Duplicate checkpoint: ${checkpoint.name}`)
    }
    seen.add(checkpoint.name)
    if (typeof checkpoint.svg !== 'string') {
      throw new Error('Invalid checkpoint data')
    }
    const captured = checkpoint.captured
    if (captured) {
      if (
        frozen.some(
          item => item.captured && item.captured.cols !== captured.cols,
        )
      ) {
        throw new Error(
          'Captured checkpoints must have the same terminal width',
        )
      }
      frozen.push(
        Object.freeze({ name: checkpoint.name, svg: checkpoint.svg, captured }),
      )
    } else {
      frozen.push(Object.freeze({ name: checkpoint.name, svg: checkpoint.svg }))
    }
  }
  const sharedHeight = Math.max(
    0,
    ...frozen.map(item => item.captured?.height ?? 0),
  )
  const normalized = frozen.map(checkpoint =>
    checkpoint.captured
      ? Object.freeze({
          ...checkpoint,
          svg: renderCaptured(checkpoint.captured, sharedHeight),
        })
      : checkpoint,
  )
  return Object.freeze({ checkpoints: Object.freeze(normalized) })
}

export async function expectTerminalAnimation(
  recording: TerminalRecording,
  options: RecordingOptions,
): Promise<void> {
  if (!safeName.test(options.flow)) {
    throw new Error(`Unsafe flow name: ${options.flow}`)
  }
  const names = recording.checkpoints.map(({ name }) => name)
  if (
    names.length === 0 ||
    new Set(names).size !== names.length ||
    names.some(name => !safeName.test(name))
  ) {
    throw new Error(
      'Recording checkpoint names must be safe, unique, and non-empty',
    )
  }
  const durations = options.durations ?? names.map(() => 900)
  if (
    durations.length !== names.length ||
    durations.some(value => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error('Each checkpoint needs a finite positive duration')
  }
  const flowDir = path.join(options.artifactsDir, options.flow)
  await mkdir(flowDir, { recursive: true })
  const checkpoints = recording.checkpoints.map(checkpoint => ({
    ...checkpoint,
    svg: optimizeSvg(checkpoint.svg),
  }))
  const rasterizer = await selectRasterizer('resvg')
  const animationFrames: AnimationFrame[] = []
  try {
    for (const checkpoint of checkpoints) {
      animationFrames.push({
        svg: checkpoint.svg,
        duration: durations[names.indexOf(checkpoint.name)]!,
      })
    }
    await Promise.all(
      checkpoints.map(async checkpoint => {
        const png = await rasterizer.toPng(checkpoint.svg, 1)
        await Promise.all([
          writeFile(
            path.join(flowDir, `${checkpoint.name}.svg`),
            checkpoint.svg,
          ),
          writeFile(path.join(flowDir, `${checkpoint.name}.png`), png),
        ])
      }),
    )
    if (animationFrames.length > 1) {
      await writeFile(
        path.join(flowDir, 'animation.svg'),
        createTerminalAnimationSvg(animationFrames),
      )
    }
    await writeFile(
      path.join(flowDir, 'sequence.json'),
      JSON.stringify({ checkpoints: names, durations }, null, 2) + '\n',
    )
  } finally {
    await rasterizer.dispose?.()
  }
  if (
    names.length !== options.expectedSequence.length ||
    names.some((name, index) => name !== options.expectedSequence[index])
  ) {
    throw new Error(
      `Checkpoint sequence mismatch: expected ${options.expectedSequence.join(', ')}, received ${names.join(', ')}`,
    )
  }
  const isSnapshotUpdate =
    process.env['SOCKET_CLI_NATIVE_TEST_UPDATE_SNAPSHOTS'] === 'true'
  const baselineRasterizer = !isSnapshotUpdate
    ? await selectRasterizer('resvg')
    : undefined
  try {
    await Promise.all(
      checkpoints.map(async checkpoint => {
        const svgPath = path.join(
          options.snapshotsDir,
          `${options.flow}.${checkpoint.name}.svg`,
        )
        if (baselineRasterizer) {
          const expectedSvg = await readFile(svgPath, 'utf8')
          try {
            await assertSamePixels(
              baselineRasterizer,
              expectedSvg,
              checkpoint.svg,
            )
          } catch (error) {
            await writeFile(
              path.join(flowDir, `${checkpoint.name}.expected.png`),
              await baselineRasterizer.toPng(expectedSvg, 1),
            )
            throw error
          }
        } else {
          await expect(checkpoint.svg).toMatchFileSnapshot(svgPath)
        }
      }),
    )
  } finally {
    await baselineRasterizer?.dispose?.()
  }
}
