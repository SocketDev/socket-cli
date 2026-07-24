import { describe, expect, it } from 'vitest'

import { runGithubScanLoop } from './create-scan-from-github.mts'
import {
  GITHUB_ERR_AUTH_FAILED,
  GITHUB_ERR_RATE_LIMIT,
} from '../../utils/github-errors.mts'

import type { CResult } from '../../types.mts'

type ScanResult = CResult<{ scanCreated: boolean }>

// Build a scanRepoFn from a map of repo -> canned result, recording the
// order of calls so we can assert the loop stops early on blocking errors.
// No module mocking — this is a plain function injected into the loop.
function fakeScanner(results: Record<string, ScanResult>): {
  fn: (repoSlug: string) => Promise<ScanResult>
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    fn: (repoSlug: string) => {
      calls.push(repoSlug)
      return Promise.resolve(results[repoSlug]!)
    },
  }
}

const scanned: ScanResult = { ok: true, data: { scanCreated: true } }
const emptyRepo: ScanResult = { ok: true, data: { scanCreated: false } }
const noManifests: ScanResult = {
  ok: false,
  message: 'No manifest files found',
  cause: 'No supported manifest files were found.',
}
const rateLimited: ScanResult = {
  ok: false,
  message: GITHUB_ERR_RATE_LIMIT,
  cause: 'GitHub API rate limit exceeded on the supplied token.',
}
const authFailed: ScanResult = {
  ok: false,
  message: GITHUB_ERR_AUTH_FAILED,
  cause: 'GitHub authentication failed.',
}

describe('runGithubScanLoop (ASK-167)', () => {
  it('stops and returns ok:false on a GitHub rate limit', async () => {
    const scanner = fakeScanner({
      'repo-a': rateLimited,
      'repo-b': scanned,
      'repo-c': scanned,
    })
    const result = await runGithubScanLoop(
      ['repo-a', 'repo-b', 'repo-c'],
      scanner.fn,
    )
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toBe(GITHUB_ERR_RATE_LIMIT)
    // Loop stopped after the first repo — no quota burned on the rest.
    expect(scanner.calls).toEqual(['repo-a'])
  })

  it('stops and returns ok:false on a GitHub auth failure', async () => {
    const scanner = fakeScanner({ 'repo-a': authFailed, 'repo-b': scanned })
    const result = await runGithubScanLoop(['repo-a', 'repo-b'], scanner.fn)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toBe(GITHUB_ERR_AUTH_FAILED)
    expect(scanner.calls).toEqual(['repo-a'])
  })

  it('carries the rate-limit cause through so the CLI can print it', async () => {
    const scanner = fakeScanner({ 'repo-a': rateLimited })
    const result = await runGithubScanLoop(['repo-a'], scanner.fn)
    expect(result.ok ? undefined : result.cause).toContain('rate limit')
  })

  it('succeeds when a repo has no manifests but the tree was empty', async () => {
    const scanner = fakeScanner({ 'repo-a': emptyRepo, 'repo-b': emptyRepo })
    const result = await runGithubScanLoop(['repo-a', 'repo-b'], scanner.fn)
    expect(result.ok).toBe(true)
    expect(scanner.calls).toEqual(['repo-a', 'repo-b'])
  })

  it('succeeds when at least one repo produced a scan', async () => {
    const scanner = fakeScanner({ 'repo-a': noManifests, 'repo-b': scanned })
    const result = await runGithubScanLoop(['repo-a', 'repo-b'], scanner.fn)
    expect(result.ok).toBe(true)
    // Both repos are attempted; a non-blocking failure does not stop the loop.
    expect(scanner.calls).toEqual(['repo-a', 'repo-b'])
  })

  it('fails when every repo errored for a non-blocking reason', async () => {
    const scanner = fakeScanner({
      'repo-a': noManifests,
      'repo-b': noManifests,
    })
    const result = await runGithubScanLoop(['repo-a', 'repo-b'], scanner.fn)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toBe('All repos failed to scan')
  })
})
