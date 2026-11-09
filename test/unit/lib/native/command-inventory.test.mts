import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  declarationFor,
  discoverNativeCommandPaths,
  literal,
  parse,
} from '../../../lib/native/command-inventory.mts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sn-command-inventory-'))
  temporaryDirectories.push(root)
  await mkdir(path.join(root, 'commands'), { recursive: true })
  return root
}

async function writeSource(
  root: string,
  file: string,
  source: string,
): Promise<void> {
  await writeFile(path.join(root, file), source)
}

describe('native command inventory utilities', () => {
  it('discovers and sorts root and nested registrations from an isolated source tree', async () => {
    const root = await fixtureRoot()
    await writeSource(
      root,
      'commands.mts',
      `
      import { cmdZed } from './commands/zed.mts'
      import { cmdAlpha } from './commands/alpha.mts'
      export const rootCommands = { zed: cmdZed, alpha: cmdAlpha }
    `,
    )
    await writeSource(
      root,
      'commands/zed.mts',
      `
      import { cmdChild } from './child.mts'
      export const cmdZed = { subcommands: { child: cmdChild } }
    `,
    )
    await writeSource(root, 'commands/child.mts', 'export const cmdChild = {}')
    await writeSource(root, 'commands/alpha.mts', 'export const cmdAlpha = {}')

    expect(await discoverNativeCommandPaths(root)).toEqual([
      'alpha',
      'zed',
      'zed child',
    ])
    const ast = await parse(path.join(root, 'commands.mts'))
    expect(literal({ type: 'Identifier', name: 'cmdZed' })).toBe('cmdZed')
    expect(declarationFor(ast, 'rootCommands').type).toBe('ObjectExpression')
  })

  it('fails closed for unresolved exports and unsupported registration references', async () => {
    const root = await fixtureRoot()
    await writeSource(
      root,
      'commands.mts',
      `
      import { missing } from './commands/item.mts'
      export const rootCommands = { item: missing }
    `,
    )
    await writeSource(root, 'commands/item.mts', 'export const other = {}')
    await expect(discoverNativeCommandPaths(root)).rejects.toThrow(
      /Could not resolve registered command missing/,
    )

    await writeSource(
      root,
      'commands.mts',
      `
      export const rootCommands = { item: notImported }
    `,
    )
    await expect(discoverNativeCommandPaths(root)).rejects.toThrow(
      /Unsupported command registration reference: notImported/,
    )
  })

  it('fails closed when a command module has ambiguous subcommand registrations', async () => {
    const root = await fixtureRoot()
    await writeSource(
      root,
      'commands.mts',
      `
      import { cmdItem } from './commands/item.mts'
      export const rootCommands = { item: cmdItem }
    `,
    )
    await writeSource(
      root,
      'commands/item.mts',
      `
      export const cmdItem = {}
      const unrelated = { subcommands: {} }
      const alsoUnrelated = { nested: { subcommands: {} } }
    `,
    )
    await expect(discoverNativeCommandPaths(root)).rejects.toThrow(
      /Ambiguous subcommand registrations for item: 2/,
    )
  })

  it('discovers the complete sorted production registration set', async () => {
    const paths = await discoverNativeCommandPaths()
    expect(paths).toHaveLength(71)
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)))
  })
})
