import { describe, expect, it } from 'vitest'

import { checkCommandDocumentation } from '../../../../scripts/repo/check/docs-commands.mts'

const inventory = {
  commands: ['alpha', 'alpha child', 'patch list'],
  aliases: [
    { alias: 'a', target: 'alpha' },
    { alias: 'alpha kid', target: 'alpha child' },
  ],
}

const documentation = `
## Command inventory

| Command | Guide |
| --- | --- |
| \`alpha\` | [Guide](commands/alpha.md) |
| \`alpha child\` | [Guide](commands/alpha.md) |
| \`patch list\` | [Guide](commands/patch.md) |

## Aliases

| Alias | Target |
| --- | --- |
| \`a\` | \`alpha\` |
| \`alpha kid\` | \`alpha child\` |
`

function sourceReader(sourcePath: string): string {
  if (
    sourcePath === 'docs/commands/alpha.md' ||
    sourcePath === 'docs/commands/patch.md'
  ) {
    return ''
  }
  throw new Error(`Missing fixture source ${sourcePath}`)
}

describe('CLI command documentation coverage', () => {
  it('accepts exact command and alias rows with existing guide links', () => {
    expect(
      checkCommandDocumentation(documentation, inventory, sourceReader),
    ).toEqual([])
  })

  it('reports missing and stale command identifiers', () => {
    const changed = documentation
      .replace('| `alpha child` | [Guide](commands/alpha.md) |\n', '')
      .replace(
        '| `patch list` | [Guide](commands/patch.md) |',
        '| `patch get <NAME>` | [Guide](commands/patch.md) |',
      )
    expect(checkCommandDocumentation(changed, inventory, sourceReader)).toEqual(
      expect.arrayContaining([
        'Commands is missing alpha child',
        'Commands has stale identifier patch get <NAME>',
      ]),
    )
  })

  it('requires each alias to have its exact target', () => {
    const changed = documentation.replace(
      '| `alpha kid` | `alpha child` |',
      '| `alpha kid` | `alpha` |',
    )
    expect(
      checkCommandDocumentation(changed, inventory, sourceReader),
    ).toContain('Alias alpha kid targets alpha; expected alpha child')
  })

  it('rejects grouped alias identifiers and duplicate command rows', () => {
    const changed = documentation
      .replace('| `a` | `alpha` |', '| `a`, `alias` | `alpha` |')
      .replace(
        '| `alpha child` | [Guide](commands/alpha.md) |',
        '| `alpha child` | [Guide](commands/alpha.md) |\n' +
          '| `alpha` | [Guide](commands/alpha.md) |',
      )
    expect(checkCommandDocumentation(changed, inventory, sourceReader)).toEqual(
      expect.arrayContaining([
        'Aliases row 1 has no exact identifier',
        'Commands duplicates alpha',
      ]),
    )
  })

  it('rejects guide links outside the local command guides', () => {
    const changed = documentation.replace(
      '[Guide](commands/patch.md)',
      '[Guide](https://example.invalid/patch)',
    )
    expect(
      checkCommandDocumentation(changed, inventory, sourceReader),
    ).toContain('Command patch list has an invalid guide link')
  })

  it('reports a new literal custom route as an undocumented command', () => {
    const changedInventory = {
      ...inventory,
      commands: [...inventory.commands, 'patch status'],
    }
    expect(
      checkCommandDocumentation(documentation, changedInventory, sourceReader),
    ).toContain('Commands is missing patch status')
  })
})
