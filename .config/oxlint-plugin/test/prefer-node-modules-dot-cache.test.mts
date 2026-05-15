/**
 * @fileoverview Unit tests for socket/prefer-node-modules-dot-cache.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-node-modules-dot-cache.mts'

describe('socket/prefer-node-modules-dot-cache', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-node-modules-dot-cache', rule, {
      valid: [
        {
          name: 'node_modules/.cache path',
          code: 'const cache = "node_modules/.cache/socket-wheelhouse-x.json"\n',
        },
        {
          // Bare `.cache` is a path segment, not a path. The literal
          // visitor must skip it — flagging would double-fire on every
          // `path.join(home, '.cache', app)` from XDG helpers (which
          // the call-shape visitor already exempts via isHomeDirExpression).
          name: 'bare ".cache" literal (not a path)',
          code: 'const seg = ".cache"\n',
        },
        {
          name: 'path.join with node_modules first',
          code: 'import path from "node:path"\nconst x = path.join("/", "node_modules", ".cache", "foo.json")\n',
        },
        {
          // XDG-spec platform-dirs helper.
          name: 'path.join(home, ".cache", ...) with `home` identifier',
          code:
            'import os from "node:os"\nimport path from "node:path"\n' +
            'const home = os.homedir()\n' +
            'const cacheDir = path.join(home, ".cache", "acorn-asb")\n',
        },
        {
          name: 'path.join with os.homedir() directly as first arg',
          code:
            'import os from "node:os"\nimport path from "node:path"\n' +
            'const cacheDir = path.join(os.homedir(), ".cache", "myapp")\n',
        },
        {
          name: 'path.join with process.env.HOME first',
          code:
            'import path from "node:path"\n' +
            'const cacheDir = path.join(process.env.HOME, ".cache", "myapp")\n',
        },
        {
          name: 'path.join with process.env["XDG_CACHE_HOME"] first',
          code:
            'import path from "node:path"\n' +
            'const cacheDir = path.join(process.env["XDG_CACHE_HOME"], "myapp")\n',
        },
        {
          name: 'path.join with `homedir` identifier first',
          code:
            'import path from "node:path"\n' +
            'function go(homedir) { return path.join(homedir, ".cache", "x") }\n',
        },
      ],
      invalid: [
        {
          name: 'repo-root .cache literal',
          code: 'const cache = ".cache/socket-wheelhouse-x.json"\n',
          errors: [{ messageId: 'pathLiteral' }],
        },
        {
          name: 'path.join with .cache only',
          code: 'import path from "node:path"\nconst x = path.join("/foo", ".cache", "bar.json")\n',
          errors: [{ messageId: 'pathJoin' }],
        },
      ],
    })
  })
})
