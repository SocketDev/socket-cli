import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

import { extractCommandInventory } from './docs-command-inventory.mts'
import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/main/run.mts'

import type { CommandInventory } from './docs-command-inventory.mts'
import type { ScriptMeta } from '../../fleet/process/main/run.mts'

export const SCRIPT_META: ScriptMeta = {
  describe: 'Check the exact CLI command and alias inventory in its reference.',
  help: 'Usage: pnpm run docs:commands:check',
}

interface MarkdownNode {
  type: string
  value?: string | undefined
  url?: string | undefined
  depth?: number | undefined
  children?: MarkdownNode[] | undefined
}

interface TableRow {
  name: string | undefined
  value: string | undefined
  guide: string | undefined
}

function isMarkdownNode(value: unknown): value is MarkdownNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  )
}

function nodeChildren(node: MarkdownNode): MarkdownNode[] {
  return node.children?.filter(isMarkdownNode) ?? []
}

function textContent(node: MarkdownNode): string {
  if (node.value !== undefined) {
    return node.value
  }
  return nodeChildren(node).map(textContent).join('').trim()
}

function inlineCode(node: MarkdownNode | undefined): string | undefined {
  if (node?.type !== 'tableCell') {
    return undefined
  }
  const children = nodeChildren(node)
  const firstChild = children[0]
  return children.length === 1 && firstChild?.type === 'inlineCode'
    ? textContent(firstChild)
    : undefined
}

function linkTarget(node: MarkdownNode | undefined): string | undefined {
  if (node === undefined) {
    return undefined
  }
  let target: string | undefined
  function visit(child: MarkdownNode): void {
    if (child.type === 'link' && child.url !== undefined) {
      target = child.url
    }
    for (const descendant of nodeChildren(child)) {
      visit(descendant)
    }
  }
  visit(node)
  return target
}

function sectionRows(
  markdown: string,
  heading: string,
  headers: [string, string],
): TableRow[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
  const headingNode = tree.children.find(
    node =>
      node.type === 'heading' &&
      node.depth === 2 &&
      node.children
        .map(child =>
          child.type === 'text' && 'value' in child ? child.value : '',
        )
        .join('') === heading,
  )
  if (headingNode === undefined) {
    throw new Error(`docs/commands.md: missing ## ${heading} section`)
  }
  const headingIndex = tree.children.indexOf(headingNode)
  const table = tree.children
    .slice(headingIndex + 1)
    .find(node => node.type === 'heading' || node.type === 'table')
  if (table?.type !== 'table') {
    throw new Error(`docs/commands.md: missing ${heading} table`)
  }
  const rows = table.children
  const header = rows[0]
  if (header?.type !== 'tableRow') {
    throw new Error(`docs/commands.md: invalid ${heading} table header`)
  }
  const headerCells = header.children
  const firstHeaderCell = headerCells[0]
  const secondHeaderCell = headerCells[1]
  if (
    headerCells.length !== 2 ||
    firstHeaderCell === undefined ||
    secondHeaderCell === undefined ||
    textContent(firstHeaderCell) !== headers[0] ||
    textContent(secondHeaderCell) !== headers[1]
  ) {
    throw new Error(
      `docs/commands.md: ${heading} table must have ${headers.join(' and ')} columns`,
    )
  }
  return rows.slice(1).map(row => {
    const cells = row.children
    const parsedRow = {
      __proto__: null,
      name: inlineCode(cells[0]),
      value: inlineCode(cells[1]),
      guide: linkTarget(cells[1]),
    }
    return parsedRow
  })
}

function uniqueRows(
  rows: TableRow[],
  section: string,
): { rows: Map<string, TableRow>; problems: string[] } {
  const result = new Map<string, TableRow>()
  const problems: string[] = []
  for (const [index, row] of rows.entries()) {
    if (row.name === undefined || row.name.length === 0) {
      problems.push(`${section} row ${index + 1} has no exact identifier`)
      continue
    }
    if (result.has(row.name)) {
      problems.push(`${section} duplicates ${row.name}`)
      continue
    }
    result.set(row.name, row)
  }
  const inventory = { __proto__: null, rows: result, problems }
  return inventory
}

function validGuide(
  guide: string | undefined,
  sourceReader: (sourcePath: string) => string,
  rowName: string,
  problems: string[],
): void {
  if (
    guide === undefined ||
    !guide.startsWith('commands/') ||
    guide.includes('..') ||
    !guide.endsWith('.md')
  ) {
    problems.push(`Command ${rowName} has an invalid guide link`)
    return
  }
  try {
    sourceReader(path.posix.join('docs', guide))
  } catch {
    problems.push(`Command ${rowName} links to missing guide ${guide}`)
  }
}

export function checkCommandDocumentation(
  markdown: string,
  inventory: CommandInventory,
  sourceReader: (sourcePath: string) => string,
): string[] {
  const problems: string[] = []
  const commandRows = uniqueRows(
    sectionRows(markdown, 'Command inventory', ['Command', 'Guide']),
    'Commands',
  )
  const aliasRows = uniqueRows(
    sectionRows(markdown, 'Aliases', ['Alias', 'Target']),
    'Aliases',
  )
  problems.push(...commandRows.problems, ...aliasRows.problems)
  const commands = new Set(inventory.commands)
  for (const command of commands) {
    const row = commandRows.rows.get(command)
    if (row === undefined) {
      problems.push(`Commands is missing ${command}`)
    } else {
      validGuide(row.guide, sourceReader, command, problems)
    }
  }
  for (const command of commandRows.rows.keys()) {
    if (!commands.has(command)) {
      problems.push(`Commands has stale identifier ${command}`)
    }
  }
  const aliases = new Map<string, string>()
  for (const alias of inventory.aliases) {
    aliases.set(alias.alias, alias.target)
  }
  for (const [alias, target] of aliases) {
    const row = aliasRows.rows.get(alias)
    if (row === undefined) {
      problems.push(`Aliases is missing ${alias}`)
    } else if (row.value !== target) {
      problems.push(
        `Alias ${alias} targets ${row.value ?? '(missing)'}; expected ${target}`,
      )
    }
  }
  for (const alias of aliasRows.rows.keys()) {
    if (!aliases.has(alias)) {
      problems.push(`Aliases has stale identifier ${alias}`)
    }
  }
  return problems
}

export async function main(): Promise<void> {
  const markdown = await readFile(`${REPO_ROOT}/docs/commands.md`, 'utf8')
  const readSource = (sourcePath: string): string =>
    readFileSync(path.join(REPO_ROOT, sourcePath), 'utf8')
  const inventory = extractCommandInventory(readSource)
  const problems = checkCommandDocumentation(markdown, inventory, readSource)
  if (problems.length > 0) {
    throw new Error(
      `Command documentation coverage failed:\n${problems.join('\n')}`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
