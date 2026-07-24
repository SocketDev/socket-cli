/**
 * Unit tests for update-manifest-by-agent's updateManifest entry point.
 *
 * Purpose: Tests the agent-dispatch logic that routes package.json overrides
 * to the right field (overrides / resolutions / pnpm.overrides /
 * pnpm-workspace.yaml) depending on the package manager and version.
 *
 * Test Coverage: - updateManifest (per-agent routing + pnpm 11+
 * pnpm-workspace.yaml integration) - usesPnpmWorkspaceOverrides -
 * getEntryIndexes / getLowestEntryIndex / getHighestEntryIndex.
 *
 * Related Files: - commands/optimize/update-manifest-by-agent.mts
 * (implementation)
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  updateManifest,
  usesPnpmWorkspaceOverrides,
} from '../../../../src/commands/optimize/update-manifest-by-agent.mts'

import type { EditablePackageJson } from '@socketsecurity/lib-stable/packages/types'

// The factory below substitutes vi.fn() mocks for the class methods; typing
// them as Mock keeps expect(pkgJson.update) clear of unbound-method.
type MockEditablePackageJson = EditablePackageJson & {
  fromJSON: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

describe('update-manifest-by-agent', () => {
  const createEditablePkgJson = (content: Record<string, unknown> = {}) => {
    const pkgJson: MockEditablePackageJson = {
      content,
      fromJSON: vi.fn((json: string) => {
        const parsed = JSON.parse(json)
        Object.assign(pkgJson.content, parsed)
      }),
      indent: '  ',
      newline: '\n',
      save: vi.fn(),
      update: vi.fn((updates: Record<string, unknown>) => {
        Object.assign(pkgJson.content, updates)
      }),
    } as unknown as MockEditablePackageJson
    return pkgJson
  }

  describe('updateManifest', () => {
    let pkgJson: MockEditablePackageJson

    beforeEach(() => {
      pkgJson = createEditablePkgJson({
        name: 'test',
      })
    })

    // Build a minimal EnvDetails-shaped object. Production code only
    // touches `editablePkgJson`, `agent`, `agentVersion`, `pkgPath`.
    const makeEnv = (overrides: Record<string, unknown> = {}) =>
      ({
        agent: 'pnpm',
        agentVersion: { major: 10, minor: 0, patch: 0 },
        editablePkgJson: pkgJson,
        pkgPath: '/tmp/test-pkg',
        ...overrides,
      }) as unknown

    it('uses resolutions for bun agent', async () => {
      await updateManifest('bun', makeEnv({ agent: 'bun' }), {
        lodash: '4.17.21',
      })
      // Since field doesn't exist, fromJSON is called.
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses pnpm field for pnpm 10 agent (legacy package.json path)', async () => {
      await updateManifest(
        'pnpm',
        makeEnv({
          agent: 'pnpm',
          agentVersion: { major: 10, minor: 0, patch: 0 },
        }),
        { lodash: '4.17.21' },
      )
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses overrides for vlt agent', async () => {
      await updateManifest('vlt', makeEnv({ agent: 'vlt' }), {
        lodash: '4.17.21',
      })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses resolutions for yarn/berry agent', async () => {
      await updateManifest('yarn/berry', makeEnv({ agent: 'yarn/berry' }), {
        lodash: '4.17.21',
      })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses resolutions for yarn/classic agent', async () => {
      await updateManifest('yarn/classic', makeEnv({ agent: 'yarn/classic' }), {
        lodash: '4.17.21',
      })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses overrides for npm agent (default)', async () => {
      await updateManifest('npm', makeEnv({ agent: 'npm' }), {
        lodash: '4.17.21',
      })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses overrides for unknown agent', async () => {
      await updateManifest(
        'unknown' as unknown,
        makeEnv({ agent: 'unknown' }),
        {
          lodash: '4.17.21',
        },
      )
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('updates existing resolutions for yarn', async () => {
      pkgJson = createEditablePkgJson({
        name: 'test',
        resolutions: { typescript: '5.0.0' },
      })
      await updateManifest(
        'yarn/berry',
        makeEnv({ agent: 'yarn/berry', editablePkgJson: pkgJson }),
        { lodash: '4.17.21' },
      )
      expect(pkgJson.update).toHaveBeenCalledWith({
        resolutions: { lodash: '4.17.21' },
      })
    })

    it('updates existing overrides for npm', async () => {
      pkgJson = createEditablePkgJson({
        name: 'test',
        overrides: { express: '4.17.0' },
      })
      await updateManifest(
        'npm',
        makeEnv({ agent: 'npm', editablePkgJson: pkgJson }),
        {
          lodash: '4.17.21',
        },
      )
      expect(pkgJson.update).toHaveBeenCalledWith({
        overrides: { lodash: '4.17.21' },
      })
    })

    it('places new overrides AFTER main when no engines/files anchor exists', async () => {
      // No engines/files -> falls through to getHighestEntryIndex(['exports','imports','main']),
      // which returns the position of `main`; we then place at that index + 1
      // because isPlacingHigher = true. Verifies the L130 +1 path.
      pkgJson = createEditablePkgJson({
        name: 'test',
        version: '1.0.0',
        main: 'index.js',
        scripts: {},
      })
      await updateManifest(
        'npm',
        makeEnv({ agent: 'npm', editablePkgJson: pkgJson }),
        {
          lodash: '4.17.21',
        },
      )

      expect(pkgJson.fromJSON).toHaveBeenCalled()
      // The new content should include overrides positioned after main.
      const fromJsonCall = (pkgJson.fromJSON as unknown).mock
        .calls[0][0] as string
      const parsed = JSON.parse(fromJsonCall)
      const keys = Object.keys(parsed)
      expect(keys.indexOf('overrides')).toBeGreaterThan(keys.indexOf('main'))
      expect(parsed.overrides).toEqual({ lodash: '4.17.21' })
    })

    describe('pnpm 11+ integration (writes to pnpm-workspace.yaml)', () => {
      let tmpDir: string

      beforeEach(() => {
        tmpDir = mkdtempSync(
          path.join(os.tmpdir(), 'socket-cli-update-manifest-test-'),
        )
      })

      afterEach(async () => {
        await safeDelete(tmpDir)
      })

      it('writes overrides to pnpm-workspace.yaml when pnpm@11+', async () => {
        pkgJson = createEditablePkgJson({ name: 'test' })
        await updateManifest(
          'pnpm',
          makeEnv({
            agent: 'pnpm',
            agentVersion: { major: 11, minor: 0, patch: 8 },
            editablePkgJson: pkgJson,
            pkgPath: tmpDir,
          }),
          { lodash: '4.17.21' },
        )

        const yamlContent = readFileSync(
          path.join(tmpDir, 'pnpm-workspace.yaml'),
          'utf8',
        )
        expect(yamlContent).toContain('overrides:')
        expect(yamlContent).toContain('lodash: 4.17.21')
      })

      it('clears stale pnpm.overrides from package.json when routing to YAML', async () => {
        // package.json has a leftover pnpm.overrides block from the
        // pnpm-10 era. Writing via the YAML path should clear it so
        // the legacy block doesn't drift silently.
        pkgJson = createEditablePkgJson({
          name: 'test',
          pnpm: { overrides: { 'old-pkg': '1.0.0' } },
        })
        await updateManifest(
          'pnpm',
          makeEnv({
            agent: 'pnpm',
            agentVersion: { major: 11, minor: 0, patch: 8 },
            editablePkgJson: pkgJson,
            pkgPath: tmpDir,
          }),
          { lodash: '4.17.21' },
        )

        // package.json's pnpm block should be cleared (update was called
        // with pnpm: undefined or pnpm: <object without overrides>).
        const updateCalls = (pkgJson.update as unknown).mock.calls as Array<
          [Record<string, unknown>]
        >
        const pnpmCalls = updateCalls.filter(([arg]) => 'pnpm' in arg)
        expect(pnpmCalls.length).toBeGreaterThan(0)
        // Latest pnpm-related update should not still have an overrides
        // member (or the whole pnpm field should be undefined).
        const lastPnpm = pnpmCalls.at(-1)![0].pnpm as
          | undefined
          | { overrides?: unknown | undefined }
        expect(
          lastPnpm === undefined ||
            lastPnpm === null ||
            !('overrides' in (lastPnpm ?? {})) ||
            !(lastPnpm as unknown).overrides,
        ).toBe(true)
      })

      it('preserves a pre-existing pnpm-workspace.yaml when merging', async () => {
        const fs = await import('node:fs')
        fs.writeFileSync(
          path.join(tmpDir, 'pnpm-workspace.yaml'),
          `# Header
packages:
  - .claude/hooks/*

minimumReleaseAge: 10080
`,
          'utf8',
        )
        pkgJson = createEditablePkgJson({ name: 'test' })
        await updateManifest(
          'pnpm',
          makeEnv({
            agent: 'pnpm',
            agentVersion: { major: 11, minor: 0, patch: 8 },
            editablePkgJson: pkgJson,
            pkgPath: tmpDir,
          }),
          { lodash: '4.17.21' },
        )

        const yamlContent = readFileSync(
          path.join(tmpDir, 'pnpm-workspace.yaml'),
          'utf8',
        )
        expect(yamlContent).toContain('# Header')
        expect(yamlContent).toContain('packages:')
        expect(yamlContent).toContain('minimumReleaseAge: 10080')
        expect(yamlContent).toContain('overrides:')
        expect(yamlContent).toContain('lodash: 4.17.21')
      })

      it('routes to package.json when pnpm < 11 (legacy path)', async () => {
        pkgJson = createEditablePkgJson({ name: 'test' })
        await updateManifest(
          'pnpm',
          makeEnv({
            agent: 'pnpm',
            agentVersion: { major: 10, minor: 12, patch: 0 },
            editablePkgJson: pkgJson,
            pkgPath: tmpDir,
          }),
          { lodash: '4.17.21' },
        )

        // Should NOT have created pnpm-workspace.yaml.
        const fs = await import('node:fs')
        expect(fs.existsSync(path.join(tmpDir, 'pnpm-workspace.yaml'))).toBe(
          false,
        )
        // Should have written to package.json (via fromJSON since field
        // didn't exist).
        expect(pkgJson.fromJSON).toHaveBeenCalled()
      })
    })
  })

  describe('usesPnpmWorkspaceOverrides', () => {
    it('returns true for pnpm 11+', () => {
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'pnpm',
          agentVersion: { major: 11, minor: 0, patch: 8 } as unknown,
        }),
      ).toBe(true)
    })

    it('returns true for pnpm 12+', () => {
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'pnpm',
          agentVersion: { major: 12, minor: 0, patch: 0 } as unknown,
        }),
      ).toBe(true)
    })

    it('returns false for pnpm 10', () => {
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'pnpm',
          agentVersion: { major: 10, minor: 12, patch: 0 } as unknown,
        }),
      ).toBe(false)
    })

    it('returns false for pnpm 9', () => {
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'pnpm',
          agentVersion: { major: 9, minor: 0, patch: 0 } as unknown,
        }),
      ).toBe(false)
    })

    it('returns false for non-pnpm agents (regardless of version)', () => {
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'npm',
          agentVersion: { major: 11, minor: 0, patch: 0 } as unknown,
        }),
      ).toBe(false)
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'yarn/berry',
          agentVersion: { major: 11, minor: 0, patch: 0 } as unknown,
        }),
      ).toBe(false)
    })
  })

  describe('getEntryIndexes / getLowestEntryIndex / getHighestEntryIndex', () => {
    const entries: Array<[string, unknown]> = [
      ['name', 'x'],
      ['version', '1.0.0'],
      ['main', 'index.js'],
      ['exports', {}],
      ['scripts', {}],
    ]

    it('getEntryIndexes returns sorted indices for matching keys', async () => {
      const { getEntryIndexes } =
        await import('../../../../src/commands/optimize/update-manifest-by-agent.mts')
      expect(getEntryIndexes(entries, ['exports', 'main'])).toEqual([2, 3])
    })

    it('getEntryIndexes filters out keys not present', async () => {
      const { getEntryIndexes } =
        await import('../../../../src/commands/optimize/update-manifest-by-agent.mts')
      expect(getEntryIndexes(entries, ['nope', 'main'])).toEqual([2])
    })

    it('getLowestEntryIndex returns -1 when no keys match', async () => {
      const { getLowestEntryIndex } =
        await import('../../../../src/commands/optimize/update-manifest-by-agent.mts')
      expect(getLowestEntryIndex(entries, ['nope'])).toBe(-1)
    })

    it('getLowestEntryIndex returns the smallest matching index', async () => {
      const { getLowestEntryIndex } =
        await import('../../../../src/commands/optimize/update-manifest-by-agent.mts')
      expect(getLowestEntryIndex(entries, ['scripts', 'main'])).toBe(2)
    })

    it('getHighestEntryIndex returns -1 when no keys match', async () => {
      const { getHighestEntryIndex } =
        await import('../../../../src/commands/optimize/update-manifest-by-agent.mts')
      expect(getHighestEntryIndex(entries, ['nope'])).toBe(-1)
    })

    it('getHighestEntryIndex returns the largest matching index', async () => {
      const { getHighestEntryIndex } =
        await import('../../../../src/commands/optimize/update-manifest-by-agent.mts')
      expect(getHighestEntryIndex(entries, ['main', 'scripts'])).toBe(4)
    })
  })
})
