/**
 * @file Cross-platform zstd compression for fleet release payloads (the
 *   GitHub-Release fleet bundle, binary publish assets). Uses Node's built-in
 *   zstd (`node:zlib`, Node 22.15+) so it needs no `zstd` CLI on any platform —
 *   the one compressor the fleet ships through. Standard: level 19, windowLog
 *   27 (large-window `--long`), multithreaded via `nbWorkers` = cpu count.
 *   Decompression speed is level-independent, so the level only costs build
 *   time; `--ultra -22` is reserved for an asset bumping a size gate.
 *   Library:  import { compressFile } from './compress.mts'
 *   CLI:      node scripts/fleet/compress.mts <input> [output.zst]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { constants, zstdCompressSync } from 'node:zlib'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

export const ZSTD_LEVEL = 19
export const ZSTD_WINDOW_LOG = 27

export interface CompressOptions {
  readonly level?: number | undefined
  readonly output?: string | undefined
  readonly windowLog?: number | undefined
  readonly workers?: number | undefined
}

export interface CompressResult {
  readonly inputBytes: number
  readonly output: string
  readonly outputBytes: number
}

/**
 * Zstd-compress `data` at the fleet standard. Pure — no filesystem. The
 * window log is clamped into the algorithm's valid range so an out-of-range
 * caller value can't throw at compression time.
 */
export function compressBytes(
  data: Uint8Array,
  options?: CompressOptions | undefined,
): Buffer {
  const opts = { __proto__: null, ...options } as CompressOptions
  return zstdCompressSync(data, {
    params: {
      [constants.ZSTD_c_compressionLevel]: opts.level ?? ZSTD_LEVEL,
      [constants.ZSTD_c_nbWorkers]: opts.workers ?? os.availableParallelism(),
      [constants.ZSTD_c_windowLog]: opts.windowLog ?? ZSTD_WINDOW_LOG,
    },
  })
}

/**
 * Zstd-compress a file to `<input>.zst` (or `options.output`). Returns the
 * output path plus the input/output byte sizes for a size-gate caller.
 */
export function compressFile(
  input: string,
  options?: CompressOptions | undefined,
): CompressResult {
  const opts = { __proto__: null, ...options } as CompressOptions
  const data = readFileSync(input)
  const compressed = compressBytes(data, opts)
  const output = opts.output ?? `${input}.zst`
  writeFileSync(output, compressed)
  return {
    __proto__: null,
    inputBytes: data.length,
    output,
    outputBytes: compressed.length,
  } as CompressResult
}

/**
 * CLI entry: `node compress.mts <input> [output.zst]`. Sets a non-zero exit
 * code on misuse rather than throwing a stack at the operator.
 */
export function main(args: readonly string[]): void {
  const input = args[0]
  if (!input) {
    logger.fail('usage: compress.mts <input-file> [output.zst]')
    process.exitCode = 1
    return
  }
  const result = compressFile(input, { output: args[1] })
  const pct = ((result.outputBytes / result.inputBytes) * 100).toFixed(1)
  logger.success(
    `${result.output} — ${result.outputBytes} of ${result.inputBytes} bytes (${pct}%)`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2))
}
