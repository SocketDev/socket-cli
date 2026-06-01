/**
 * @file Unit tests for the prefer-stable-self-import oxlint rule. Spawns the
 *   real oxlint binary against fixture files in a tmp dir (see
 *   lib/rule-tester.mts). Each case writes a `package.json` fixture so the
 *   rule's owned-package walk-up has something to find. Skips silently when
 *   `oxlint` isn't on PATH.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-stable-self-import.mts'

const OWNED = { name: '@socketsecurity/lib' }

describe('socket/prefer-stable-self-import', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-stable-self-import', rule, {
      valid: [
        {
          name: 'owned package via -stable alias (scripts/)',
          filename: 'scripts/foo.mts',
          packageJson: OWNED,
          code: "import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'\n",
        },
        {
          name: 'non-owned package via bare name is fine (scripts/)',
          filename: 'scripts/foo.mts',
          packageJson: OWNED,
          code: "import { x } from '@socketsecurity/registry/y'\n",
        },
        {
          name: 'bare owned import OUTSIDE scripts/ + hooks/ is allowed',
          filename: 'src/foo.mts',
          packageJson: OWNED,
          code: "import { x } from '@socketsecurity/lib/y'\n",
        },
        {
          name: 'test files under scripts/ are exempt',
          filename: 'scripts/test/foo.test.mts',
          packageJson: OWNED,
          code: "import { x } from '@socketsecurity/lib/y'\n",
        },
        {
          name: 'similar-but-not-owned name is not flagged',
          filename: 'scripts/foo.mts',
          packageJson: OWNED,
          // `@socketsecurity/lib-extra` is NOT `@socketsecurity/lib`.
          code: "import { x } from '@socketsecurity/lib-extra/y'\n",
        },
      ],
      invalid: [
        {
          name: 'bare owned subpath import in scripts/',
          filename: 'scripts/foo.mts',
          packageJson: OWNED,
          code: "import { getDefaultLogger } from '@socketsecurity/lib/logger/default'\n",
          errors: [{ messageId: 'preferStable' }],
          output:
            "import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'\n",
        },
        {
          name: 'bare owned import in .claude/hooks/',
          filename: '.claude/hooks/foo/index.mts',
          packageJson: OWNED,
          code: "import { x } from '@socketsecurity/lib/objects/predicates'\n",
          errors: [{ messageId: 'preferStable' }],
          output:
            "import { x } from '@socketsecurity/lib-stable/objects/predicates'\n",
        },
        {
          name: 'bare owned bare-package import (no subpath)',
          filename: 'scripts/foo.mts',
          packageJson: OWNED,
          code: "import x from '@socketsecurity/lib'\n",
          errors: [{ messageId: 'preferStable' }],
          output: "import x from '@socketsecurity/lib-stable'\n",
        },
        {
          name: 'export-from re-export is also flagged',
          filename: 'scripts/foo.mts',
          packageJson: OWNED,
          code: "export { x } from '@socketsecurity/lib/y'\n",
          errors: [{ messageId: 'preferStable' }],
          output: "export { x } from '@socketsecurity/lib-stable/y'\n",
        },
      ],
    })
  })
})
