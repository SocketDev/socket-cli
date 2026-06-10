/**
 * @file Unit tests for the prefer-stable-external-semver oxlint rule. Spawns
 *   the real oxlint binary against fixture files in a tmp dir (see
 *   lib/rule-tester.mts). Skips silently when `oxlint` isn't on PATH so a
 *   fresh-laptop checkout doesn't false-fail before `pnpm install` materializes
 *   the bin link. Why the rule exists: bare `semver` from npm carries weeks of
 *   fresh-tarball risk during the soak window. The wheelhouse vendors a pinned,
 *   vetted semver under `@socketsecurity/lib-stable/external/semver`. The rule
 *   rewrites bare `import ... from "semver"` to the vetted path; rewriting the
 *   path is deterministic so the autofix is safe.
 */

import { describe, test } from 'node:test'

import rule from '../index.mts'
import { RuleTester } from '../../../lib/rule-tester.mts'

describe('socket/prefer-stable-external-semver', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-stable-external-semver', rule, {
      valid: [
        {
          name: 'already importing the vetted path',
          code: 'import semver from "@socketsecurity/lib-stable/external/semver"\n',
        },
        {
          name: 'unrelated import',
          code: 'import path from "node:path"\n',
        },
      ],
      invalid: [
        {
          name: 'bare default import',
          code: 'import semver from "semver"\n',
          errors: [{ messageId: 'banned' }],
          output:
            'import semver from "@socketsecurity/lib-stable/external/semver"\n',
        },
        {
          name: 'bare named import',
          code: 'import { gte } from "semver"\n',
          errors: [{ messageId: 'banned' }],
          output:
            'import { gte } from "@socketsecurity/lib-stable/external/semver"\n',
        },
      ],
    })
  })
})
