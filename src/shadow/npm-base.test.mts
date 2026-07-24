import { describe, expect, it } from 'vitest'

import { buildNpmNodeOptionsArg } from './npm-base.mts'

// The permission flags shadowNpmBase injects on Node versions that support
// --permission. Mirrors the array built in npm-base.mts.
const permArgs = [
  '--permission',
  '--allow-child-process',
  '--allow-fs-read=*',
  '--allow-fs-write=/project/*',
]

describe('buildNpmNodeOptionsArg', () => {
  it('does not wrap the value in quotes (issue #1160)', () => {
    // Literal quotes survive spawn() (no shell) and get re-tokenized by
    // consumers like Next.js, which strips the leading quote off --permission
    // and crashes Node >= 24 with ERR_MISSING_OPTION.
    const result = buildNpmNodeOptionsArg(undefined, undefined, permArgs)

    expect(result).not.toContain("'")
    expect(result).not.toContain('"')
    expect(result).toBe(
      '--node-options=--permission --allow-child-process --allow-fs-read=* --allow-fs-write=/project/*',
    )
    // The NODE_OPTIONS value must keep --permission as a clean, standalone
    // token so a whitespace re-tokenizer (Next.js) doesn't orphan the
    // --allow-* flags.
    const value = result.slice('--node-options='.length)
    expect(value.split(' ')).toContain('--permission')
  })

  it('merges an inherited NODE_OPTIONS env value ahead of perm flags (issue #1036)', () => {
    const result = buildNpmNodeOptionsArg(
      '--max-old-space-size=4096',
      undefined,
      permArgs,
    )

    expect(result).toBe(
      '--node-options=--max-old-space-size=4096 --permission --allow-child-process --allow-fs-read=* --allow-fs-write=/project/*',
    )
  })

  it('preserves the inherited NODE_OPTIONS even when there are no perm flags', () => {
    const result = buildNpmNodeOptionsArg('--enable-source-maps', undefined, [])

    expect(result).toBe('--node-options=--enable-source-maps')
  })

  it('strips the --node-options= prefix from an npm --node-options arg', () => {
    const result = buildNpmNodeOptionsArg(
      undefined,
      '--node-options=--trace-warnings',
      permArgs,
    )

    expect(result).toBe(
      '--node-options=--trace-warnings --permission --allow-child-process --allow-fs-read=* --allow-fs-write=/project/*',
    )
  })

  it('merges env NODE_OPTIONS, the npm --node-options arg, and perm flags in order', () => {
    const result = buildNpmNodeOptionsArg(
      '--enable-source-maps',
      '--node-options=--trace-warnings',
      permArgs,
    )

    expect(result).toBe(
      '--node-options=--enable-source-maps --trace-warnings --permission --allow-child-process --allow-fs-read=* --allow-fs-write=/project/*',
    )
  })

  it('emits an empty value when nothing is provided', () => {
    const result = buildNpmNodeOptionsArg(undefined, undefined, [])

    expect(result).toBe('--node-options=')
  })

  it('drops an empty-string env NODE_OPTIONS instead of adding a stray space', () => {
    const result = buildNpmNodeOptionsArg('', undefined, permArgs)

    expect(result).toBe(
      '--node-options=--permission --allow-child-process --allow-fs-read=* --allow-fs-write=/project/*',
    )
  })
})
