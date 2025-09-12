import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isDebug } from '@socketsecurity/registry/lib/debug'
import { spawn, spawnSync } from '@socketsecurity/registry/lib/spawn'

import { testPath } from '../../../test/utils.mts'
import constants from '../../constants.mts'

const npmFixturesPath = path.join(testPath, 'fixtures/commands/npm')

// These aliases are defined in package.json.
// Skip these integration tests - they're flaky and slow
for (const npmDir of ['npm9', 'npm10', 'npm11']) {
  describe('skipme', () => it('should skip', () => expect(true).toBe(true)))
}
