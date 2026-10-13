import { describe, expect, it } from 'vitest'

import { extractCommandInventory } from '../../../../../scripts/repo/docs/commands/inventory.mts'
import { extractCustomRoutes } from '../../../../../scripts/repo/docs/commands/custom-routes.mts'
import { checkCommandDocumentation } from '../../../../../scripts/repo/check/docs-commands-are-complete.mts'

function sourceReader(
  files: Record<string, string>,
): (sourcePath: string) => string {
  return sourcePath => {
    const source = files[sourcePath]
    if (source === undefined) {
      throw new Error(`Missing fixture source ${sourcePath}`)
    }
    return source
  }
}

function basicFiles(): Record<string, string> {
  return {
    'src/commands.mts': `
      import { cmdAlpha } from './alpha.mts'
      export const rootCommands = { alpha: cmdAlpha }
      export const rootAliases = { a: { argv: ['alpha'] } }
    `,
    'src/alpha.mts': `
      import { defineSubcommandGroup } from './util/cli/define-subcommand-group.mts'
      import { cmdChild } from './child.mts'
      export const cmdAlpha = defineSubcommandGroup({
        name: 'alpha',
        description: 'Alpha',
        subcommands: { child: cmdChild },
        aliases: { kid: { argv: ['child'] } },
      })
    `,
    'src/child.mts': `
      import { cmdLeaf } from './leaf.mts'
      import { meowWithSubcommands as routeCommand } from './util/cli/with-subcommands.mjs'
      export const cmdChild = {
        async run() {
          await routeCommand(
            { subcommands: { leaf: cmdLeaf } },
            { aliases: { tip: { argv: ['leaf'] } } },
          )
        },
      }
    `,
    'src/leaf.mts': `export const cmdLeaf = { run() {} }`,
    'src/util/cli/define-subcommand-group.mts': `export function defineSubcommandGroup() {}`,
    'src/util/cli/with-subcommands.mts': `export function meowWithSubcommands() {}`,
    'src/command/patch/cmd-patch.mts': `
      import { runPatchList } from './patch-list-command.mts'
      import { runPatchRemove } from './patch-removal-command.mts'
      export async function run() {
        const subcommand = forwardArgs[0]
        const subcommandArgs = forwardArgs.slice(1)
        if (subcommand === 'list') await runPatchList(subcommandArgs)
        if (subcommand === 'remove' && subcommandArgs.includes('--skip-rollback')) {
          await runPatchRemove(subcommandArgs)
        }
      }
    `,
    'src/command/patch/patch-list-command.mts': `export function runPatchList() {}`,
    'src/command/patch/patch-removal-command.mts': `export function runPatchRemove() {}`,
    'src/command/sfw/cmd-sfw.mts': `
      import { runFirewallCaCommand } from '../firewall/ca-command.mts'
      export async function run() {
        const sfwArgs = commandArgs
        if (sfwArgs[0] === 'ca') await runFirewallCaCommand(sfwArgs.slice(1))
      }
    `,
    'src/command/firewall/ca-command.mts': `
      export function validateFirewallCaArguments(positionals) {
        if (!['init', 'path', 'trust'].includes(positionals[0] ?? '')) throw Error()
      }
    `,
  }
}

describe('CLI command inventory extraction', () => {
  it('resolves factory and inline routers and preserves alias case', () => {
    const inventory = extractCommandInventory(sourceReader(basicFiles()))
    expect(inventory.commands).toEqual([
      'alpha',
      'alpha child',
      'alpha child leaf',
    ])
    expect(inventory.aliases).toEqual([
      { alias: 'a', target: 'alpha' },
      { alias: 'alpha child tip', target: 'alpha child leaf' },
      { alias: 'alpha kid', target: 'alpha child' },
    ])
  })

  it('resolves .mjs specifiers to their .mts source sibling', () => {
    const files = basicFiles()
    delete files['src/util/cli/with-subcommands.mjs']
    expect(extractCommandInventory(sourceReader(files)).commands).toContain(
      'alpha child leaf',
    )
  })

  it('accepts known command leaf factories without treating them as routers', () => {
    const files = basicFiles()
    files['src/commands.mts'] = `
      import { cmdAlpha } from './alpha.mts'
      import { cmdHandoff } from './handoff.mts'
      export const rootCommands = { alpha: cmdAlpha, handoff: cmdHandoff }
      export const rootAliases = {}
    `
    files['src/handoff.mts'] = `
      import { defineHandoffCommand } from './util/cli/define-handoff.mts'
      export const cmdHandoff = defineHandoffCommand({ name: 'handoff' })
    `
    files['src/util/cli/define-handoff.mts'] =
      'export function defineHandoffCommand() {}'
    const inventory = extractCommandInventory(sourceReader(files))
    expect(inventory.commands).toContain('handoff')
  })

  it('rejects cycles on the current command route', () => {
    const files = basicFiles()
    files['src/alpha.mts'] = `
      import { defineSubcommandGroup } from './util/cli/define-subcommand-group.mts'
      import { cmdAlpha } from './alpha.mts'
      export const cmdAlpha = defineSubcommandGroup({
        name: 'alpha', description: 'Alpha', subcommands: { loop: cmdAlpha },
      })
    `
    expect(() => extractCommandInventory(sourceReader(files))).toThrow(
      'command routing cycle at alpha loop',
    )
  })

  it('rejects spread command registries', () => {
    const files = basicFiles()
    files['src/commands.mts'] = `
      import { cmdAlpha } from './alpha.mts'
      const more = { beta: cmdAlpha }
      export const rootCommands = { alpha: cmdAlpha, ...more }
      export const rootAliases = {}
    `
    expect(() => extractCommandInventory(sourceReader(files))).toThrow(
      'dynamic object entry',
    )
  })

  it('reports unresolved local imports with file and line', () => {
    const files = basicFiles()
    files['src/commands.mts'] = `
      import { cmdAlpha } from './missing.mts'
      export const rootCommands = { alpha: cmdAlpha }
      export const rootAliases = {}
    `
    expect(() => extractCommandInventory(sourceReader(files))).toThrow(
      'src/commands.mts:2: unresolved local import ./missing.mts',
    )
  })

  it('extracts custom routes only from reachable command handlers', () => {
    const files = basicFiles()
    expect(extractCommandInventory(sourceReader(files)).commands).not.toContain(
      'patch list',
    )
    files['src/commands.mts'] = `
      import { cmdPatch } from './command/patch/cmd-patch.mts'
      import { cmdSfw } from './command/sfw/cmd-sfw.mts'
      export const rootCommands = { patch: cmdPatch, sfw: cmdSfw }
      export const rootAliases = {}
    `
    files['src/command/patch/cmd-patch.mts'] = `
      import { runPatchList } from './patch-list-command.mts'
      import { runPatchRemove } from './patch-removal-command.mts'
      export const cmdPatch = { run }
      export async function run() {
        const subcommand = forwardArgs[0]
        if (subcommand === 'list') await runPatchList()
        if (subcommand === 'remove' && args.includes('--skip-rollback')) await runPatchRemove()
      }
    `
    files['src/command/sfw/cmd-sfw.mts'] = `
      import { runFirewallCaCommand } from '../firewall/ca-command.mts'
      export const cmdSfw = { run }
      export async function run() {
        if (sfwArgs[0] === 'ca') await runFirewallCaCommand(sfwArgs.slice(1))
      }
    `
    files['src/command/firewall/ca-command.mts'] = `
      export function runFirewallCaCommand(positionals) {
        validateFirewallCaArguments(positionals)
      }
      export function validateFirewallCaArguments(positionals) {
        if (!['init', 'path', 'trust'].includes(positionals[0] ?? '')) throw Error()
      }
    `
    expect(extractCommandInventory(sourceReader(files)).commands).toEqual([
      'patch',
      'patch list',
      'patch remove',
      'sfw',
      'sfw ca',
      'sfw ca init',
      'sfw ca path',
      'sfw ca trust',
    ])
  })

  it('rejects an unknown imported patch dispatch handler', () => {
    const files = basicFiles()
    files['src/command/patch/cmd-patch.mts'] = `
      import { unexpectedHandler } from './unexpected.mts'
      export async function run() {
        const subcommand = forwardArgs[0]
        if (subcommand === 'unexpected') await unexpectedHandler()
      }
    `
    files['src/command/patch/unexpected.mts'] =
      'export function unexpectedHandler() {}'
    expect(() =>
      extractCustomRoutes(sourceReader(files), 'patch', ['patch']),
    ).toThrow('unsupported patch route handler')
  })

  it('rejects dynamic router options instead of omitting aliases', () => {
    const files = basicFiles()
    files['src/child.mts'] = `
      import { meowWithSubcommands } from './util/cli/with-subcommands.mjs'
      export const cmdChild = {
        async run() {
          await meowWithSubcommands({ subcommands: {} }, routerOptions)
        },
      }
    `
    expect(() => extractCommandInventory(sourceReader(files))).toThrow(
      'dynamic subcommand router options',
    )
  })

  it('rejects CA allowlists that inspect a different positional', () => {
    const files = basicFiles()
    files['src/command/firewall/ca-command.mts'] = `
      export function runFirewallCaCommand(positionals) {
        validateFirewallCaArguments(positionals)
      }
      export function validateFirewallCaArguments(positionals) {
        if (!['init', 'path', 'trust'].includes(positionals[1] ?? '')) throw Error()
      }
    `
    expect(() =>
      extractCustomRoutes(sourceReader(files), 'sfw', ['sfw']),
    ).toThrow('unsupported CA command allowlist')
  })

  it('reports an added literal custom route as missing documentation', () => {
    const files = basicFiles()
    files['src/commands.mts'] = `
      import { cmdPatch } from './command/patch/cmd-patch.mts'
      export const rootCommands = { patch: cmdPatch }
      export const rootAliases = {}
    `
    const patchSource = files['src/command/patch/cmd-patch.mts']
    if (patchSource === undefined) {
      throw new Error('Missing patch fixture source')
    }
    files['src/command/patch/cmd-patch.mts'] = patchSource
      .replace(
        "import { runPatchRemove } from './patch-removal-command.mts'",
        "import { runPatchRemove } from './patch-removal-command.mts'\n" +
          "import { statusRoute } from './patch-status-command.mts'",
      )
      .replace(
        'export async function run()',
        'export const cmdPatch = { run }\nexport async function run()',
      )
      .replace(
        "if (subcommand === 'list') await runPatchList(subcommandArgs)",
        "if (subcommand === 'status') await statusRoute(subcommandArgs)\n" +
          "if (subcommand === 'list') await runPatchList(subcommandArgs)",
      )
    files['src/command/patch/patch-status-command.mts'] =
      'export function statusRoute() {}'
    const readSource = sourceReader(files)
    const inventory = extractCommandInventory(readSource)
    const markdown = [
      '## Command inventory',
      '',
      '| Command | Guide |',
      '| --- | --- |',
      ...inventory.commands
        .filter(command => command !== 'patch status')
        .map(command => `| \`${command}\` | [Guide](commands/guide.md) |`),
      '',
      '## Aliases',
      '',
      '| Alias | Target |',
      '| --- | --- |',
      ...inventory.aliases.map(
        alias => `| \`${alias.alias}\` | \`${alias.target}\` |`,
      ),
    ].join('\n')
    const readGuide = (sourcePath: string): string => {
      if (sourcePath === 'docs/commands/guide.md') {
        return ''
      }
      return readSource(sourcePath)
    }
    expect(checkCommandDocumentation(markdown, inventory, readGuide)).toContain(
      'Commands is missing patch status',
    )
  })
})
