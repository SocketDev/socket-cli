/**
 * Unit tests for the `--describe` fast path (util/cli/describe-manifest.mts):
 * the argv sniff, the registry-driven manifest walk, and the text/json
 * renderers, driven over a fixture registry with literal expectations. The
 * live-registry invariants (every command registered, described, and typed)
 * are commands.test.mts territory.
 */

import { describe, expect, it } from 'vitest'

import {
  buildRootManifest,
  describeRequest,
  renderDescribe,
} from '../../../../src/util/cli/describe-manifest.mts'

import type { CliSubcommand } from '../../../../src/util/cli/with-subcommands-shared.mts'

const SCHEMA_URL =
  'https://raw.githubusercontent.com/SocketDev/socket-wheelhouse/main/schemas/cli-describe.schema.json'

const noopRun: CliSubcommand['run'] = async () => {}

const FIXTURE_COMMANDS: Readonly<Record<string, CliSubcommand>> = {
  frob: { description: 'Frob one widget', run: noopRun },
  probe: { description: 'Probe the frobber', hidden: true, run: noopRun },
}

describe('describeRequest', () => {
  it('returns undefined when --describe is absent', () => {
    expect(describeRequest([])).toBe(undefined)
    expect(describeRequest(['scan', 'create', '--json'])).toBe(undefined)
  })

  it('returns text for a bare --describe and json when --json rides along', () => {
    expect(describeRequest(['--describe'])).toBe('text')
    expect(describeRequest(['--describe', '--json'])).toBe('json')
    expect(describeRequest(['--json', '--describe'])).toBe('json')
  })
})

describe('buildRootManifest', () => {
  const manifest = buildRootManifest({
    name: 'socket',
    subcommands: FIXTURE_COMMANDS,
    version: '1.2.3',
  })

  it('walks the registry, keeping hidden commands honest', () => {
    expect(manifest.commands).toEqual([
      { name: 'frob', description: 'Frob one widget' },
      { name: 'probe', description: 'Probe the frobber', hidden: true },
    ])
  })

  it('stamps the canonical $schema, name, and version', () => {
    expect(manifest.$schema).toBe(SCHEMA_URL)
    expect(manifest.name).toBe('socket')
    expect(manifest.version).toBe('1.2.3')
  })
})

describe('renderDescribe', () => {
  const manifest = buildRootManifest({
    name: 'socket',
    subcommands: FIXTURE_COMMANDS,
    version: '1.2.3',
  })

  it('renders the one-liner for text', () => {
    const out = renderDescribe('text', manifest)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.split('\n').filter(Boolean).length).toBe(1)
  })

  it('renders one parseable JSON document for json', () => {
    const parsed = JSON.parse(renderDescribe('json', manifest)) as {
      $schema: string
      commands: Array<{ name: string }>
    }
    expect(parsed.$schema).toBe(SCHEMA_URL)
    expect(parsed.commands[0]?.name).toBe('frob')
  })
})
