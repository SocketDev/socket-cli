/**
 * @fileoverview Tests for the token-guard hook.
 *
 * Runs the hook as a subprocess (node --test), piping a tool-use
 * payload on stdin and asserting on the exit code + stderr. Exit 2
 * means the hook refused the command; exit 0 means it passed it
 * through.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { whichSync } from '@socketsecurity/lib/bin'
import { spawnSync } from '@socketsecurity/lib/spawn'

const hookScript = new URL('../index.mts', import.meta.url).pathname
const nodeBin = whichSync('node')
if (!nodeBin) {
  throw new Error('"node" not found on PATH')
}

function runHook(command: string, toolName = 'Bash'): {
  code: number | null
  stdout: string
  stderr: string
} {
  const input = JSON.stringify({
    tool_name: toolName,
    tool_input: { command },
  })
  const result = spawnSync(nodeBin, [hookScript], {
    input,
    timeout: 5_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return {
    code: result.status,
    stdout: (result.stdout || '').toString(),
    stderr: (result.stderr || '').toString(),
  }
}

describe('token-guard hook', () => {
  describe('allows safe commands', () => {
    it('plain echo', () => {
      assert.equal(runHook('echo hello').code, 0)
    })
    it('git log', () => {
      assert.equal(runHook('git log -1 --oneline').code, 0)
    })
    it('pnpm install', () => {
      assert.equal(runHook('pnpm install').code, 0)
    })
    it('node script', () => {
      assert.equal(runHook('node scripts/build.mts').code, 0)
    })
    it('sed with redaction on .env', () => {
      assert.equal(
        runHook("sed 's/=.*/=<redacted>/' .env.local").code,
        0,
      )
    })
    it('grep key-names-only on .env', () => {
      assert.equal(
        runHook("grep -v '^#' .env.local | cut -d= -f1").code,
        0,
      )
    })
    it('curl without Authorization header', () => {
      assert.equal(runHook('curl -sS https://api.example.com').code, 0)
    })
    it('curl with auth piped to jq', () => {
      assert.equal(
        runHook(
          'curl -sS -H "Authorization: Bearer $TOKEN" https://api.example.com | jq .name',
        ).code,
        0,
      )
    })
    it('curl with auth redirected to file', () => {
      assert.equal(
        runHook(
          'curl -sS -H "Authorization: Bearer $TOKEN" https://api.example.com > out.json',
        ).code,
        0,
      )
    })
    it('non-Bash tool is always allowed', () => {
      assert.equal(runHook('env', 'Edit').code, 0)
    })
  })

  describe('blocks literal token shapes', () => {
    it('Val Town token', () => {
      const r = runHook('echo vtwn_ABCDEFGHIJKL')
      assert.equal(r.code, 2)
      assert.match(r.stderr, /Val Town token/)
    })
    it('Linear API token', () => {
      const r = runHook('echo lin_api_ABCDEFGHIJKLMNOP')
      assert.equal(r.code, 2)
      assert.match(r.stderr, /Linear API token/)
    })
    it('GitHub PAT', () => {
      const r = runHook(
        'echo ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcd1234',
      )
      assert.equal(r.code, 2)
      assert.match(r.stderr, /GitHub personal access token/)
    })
    it('AWS access key', () => {
      const r = runHook('echo AKIAIOSFODNN7EXAMPLE')
      assert.equal(r.code, 2)
      assert.match(r.stderr, /AWS access key/)
    })
    it('Stripe test secret', () => {
      const r = runHook('echo sk_test_ABCDEFGHIJKLMNOP')
      assert.equal(r.code, 2)
      assert.match(r.stderr, /Stripe test secret/)
    })
    it('JWT', () => {
      const r = runHook(
        'echo eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      )
      assert.equal(r.code, 2)
      assert.match(r.stderr, /JWT/)
    })
    it('redacts the command in stderr so the literal token is not re-logged', () => {
      const r = runHook('echo vtwn_SECRETVALUE')
      assert.equal(r.code, 2)
      assert.doesNotMatch(r.stderr, /SECRETVALUE/)
      assert.match(r.stderr, /suppressed/)
    })
  })

  describe('blocks env/printenv dumps', () => {
    it('bare env', () => {
      assert.equal(runHook('env').code, 2)
    })
    it('env piped without redactor', () => {
      assert.equal(runHook('env | grep FOO').code, 2)
    })
    it('printenv', () => {
      assert.equal(runHook('printenv').code, 2)
    })
    it('export -p', () => {
      assert.equal(runHook('export -p').code, 2)
    })
  })

  describe('blocks .env reads without redaction', () => {
    it('cat .env.local', () => {
      assert.equal(runHook('cat .env.local').code, 2)
    })
    it('head .env', () => {
      assert.equal(runHook('head .env').code, 2)
    })
    it('less .env.production', () => {
      assert.equal(runHook('less .env.production').code, 2)
    })
  })

  describe('blocks curl with auth to unfiltered stdout', () => {
    it('plain curl -H Authorization', () => {
      const r = runHook(
        'curl -sS -H "Authorization: Bearer $TOKEN" https://api.example.com',
      )
      assert.equal(r.code, 2)
      assert.match(r.stderr, /Authorization header and unsanitized stdout/)
    })
  })

  describe('blocks sensitive-env-name references without redaction', () => {
    it('echoing $API_KEY', () => {
      assert.equal(runHook('echo $API_KEY').code, 2)
    })
    it('ruby -e with $TOKEN', () => {
      assert.equal(
        runHook('ruby -e "puts ENV[\'ACCESS_TOKEN\']"').code,
        2,
      )
    })
  })

  describe('does not false-positive on substring of sensitive name', () => {
    // Regression: `PATHS-ALLOWLIST.YML` toUpperCase()d contains `PASS`
    // as a substring, which the pre-fix unbounded match treated as
    // a sensitive env reference. Word-boundary fix means `PASS` must
    // be a standalone token (or at a `_`/`-`/`.`/`/` boundary).
    it('paths-allowlist.yml does not trip PASS', () => {
      assert.equal(runHook('cat .github/paths-allowlist.yml').code, 0)
    })
    it('AUTHOR_NAME does not trip AUTH', () => {
      // AUTHOR ends with R; the boundary-after match correctly skips
      // it because the next char is `_`, but `AUTH` followed by `O`
      // (alphanumeric) is not a token boundary.
      assert.equal(runHook('echo $AUTHOR_NAME').code, 0)
    })
    it('PASSAGE_TIME does not trip PASS', () => {
      assert.equal(runHook('echo $PASSAGE_TIME').code, 0)
    })
  })

  describe('fails open on malformed input', () => {
    it('empty stdin', () => {
      const r = spawnSync(nodeBin, [hookScript], {
        input: '',
        timeout: 5_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      assert.equal(r.status, 0)
    })
    it('non-JSON stdin', () => {
      const r = spawnSync(nodeBin, [hookScript], {
        input: 'not json',
        timeout: 5_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      assert.equal(r.status, 0)
    })
    it('empty command', () => {
      assert.equal(runHook('').code, 0)
    })
  })
})
