/**
 * @file Unit tests for socket/no-bare-spawn-childproc-access.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-bare-spawn-childproc-access.mts'

describe('socket/no-bare-spawn-childproc-access', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-bare-spawn-childproc-access', rule, {
      valid: [
        {
          name: 'destructured { process } — the correct stream/event form',
          code: 'const { process: child } = spawn(cmd, args)\nchild.stderr.on("data", f)\n',
        },
        {
          name: 'routed through .process',
          code: 'const c = spawn(cmd, args)\nc.process.stdin.end(x)\n',
        },
        {
          name: 'awaited wrapper for code/stdout (no ChildProcess access)',
          code: 'const { code, stderr } = await spawn(cmd, args)\n',
        },
        {
          name: '.on on an unrelated object (not a spawn return)',
          code: 'const emitter = makeEmitter()\nemitter.on("data", f)\n',
        },
        {
          name: 'a spawn var whose accessed member is NOT a ChildProcess member',
          code: 'const c = spawn(cmd, args)\nconst p = c.process\n',
        },
        {
          name: 'allow comment (on the flagged access line)',
          code: 'const c = spawn(cmd, args)\n// socket-lint: allow bare-spawn-access\nc.stderr.on("data", f)\n',
        },
      ],
      invalid: [
        {
          name: 'bare spawn → .stderr.on',
          code: 'const child = spawn(cmd, args)\nchild.stderr.on("data", f)\n',
          errors: [{ messageId: 'bareSpawnAccess' }],
        },
        {
          name: 'bare spawn → .on("exit")',
          code: 'const c = spawn(cmd, args)\nc.on("exit", f)\n',
          errors: [{ messageId: 'bareSpawnAccess' }],
        },
        {
          name: 'bare spawn → .stdin.end',
          code: 'const c = spawn(cmd, args)\nc.stdin.end(line)\n',
          errors: [{ messageId: 'bareSpawnAccess' }],
        },
        {
          name: 'bare spawn → .kill / .pid',
          code: 'const c = spawn(cmd, args)\nc.kill()\nconst id = c.pid\n',
          errors: [
            { messageId: 'bareSpawnAccess' },
            { messageId: 'bareSpawnAccess' },
          ],
        },
        {
          name: 'member-form spawn (lib.spawn) still tracked',
          code: 'const c = lib.spawn(cmd, args)\nc.stderr.on("data", f)\n',
          errors: [{ messageId: 'bareSpawnAccess' }],
        },
      ],
    })
  })
})
