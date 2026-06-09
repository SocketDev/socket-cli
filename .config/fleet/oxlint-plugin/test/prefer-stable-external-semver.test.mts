/**
 * @file Unit tests for the prefer-stable-external-semver oxlint rule. Spawns
 *   the real oxlint binary against fixture files in a tmp dir (see
 *   lib/rule-tester.mts). Skips silently when `oxlint` isn't on PATH so a
 *   fresh-laptop checkout doesn't false-fail before `pnpm install` materializes
 *   the bin link. Why the rule exists: bare `semver` from npm carries weeks of
 *   fresh-tarball risk during the soak window, and shipping it as a runtime dep
 *   defeats the bundled-deps policy. The wheelhouse vendors a pinned, vetted
 *   semver internally and exposes it through the curated
 *   `@socketsecurity/lib-stable/versions/*` helpers. The rule is report-only:
 *   the public surface is named helpers across several modules, so there is no
 *   single specifier to autofix to — the author picks the right helper.
 */

import { describe, test } from 'node:test'

import rule from '../rules/prefer-stable-external-semver.mts'
import { RuleTester } from '../lib/rule-tester.mts'

describe('socket/prefer-stable-external-semver', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-stable-external-semver', rule, {
      valid: [
        {
          name: 'already using a curated versions helper',
          code: 'import { isValidVersion } from "@socketsecurity/lib-stable/versions/parse"\n',
        },
        {
          name: 'type-only import is allowed',
          code: 'import type { ReleaseType } from "semver"\n',
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
        },
        {
          name: 'bare named import',
          code: 'import { gte } from "semver"\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'bare subpath import',
          code: 'import satisfies from "semver/functions/satisfies"\n',
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
