import { afterEach, describe, expect, it, vi } from 'vitest'

import { upsertPullRequest } from '../scripts/release/github-api.mts'
import { assertBumpOnly } from '../scripts/release/open-release-pr.mts'
import { releasePullRequestBody } from '../scripts/release/release-branch.mts'

const PR_CONFIG = {
  apiUrl: 'https://api.example.test',
  base: 'v1.x',
  body: 'fixture body',
  head: 'npm-publish-v1.5.1',
  repo: 'fixture/release-cli',
  title: 'chore(release): 1.5.1',
  token: 'placeholder',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('assertBumpOnly', () => {
  it('accepts exactly the changelog and the manifest in any order', () => {
    expect(() => assertBumpOnly(['package.json', 'CHANGELOG.md'])).not.toThrow()
  })

  it.each([
    [[]],
    [['package.json']],
    [['CHANGELOG.md', 'package.json', 'scripts/release/bump.mts']],
    [['CHANGELOG.md', 'pnpm-lock.yaml']],
  ])('refuses %j', files => {
    expect(() => assertBumpOnly(files)).toThrow(/exactly CHANGELOG.md/)
  })
})

describe('upsertPullRequest', () => {
  it('opens a PR when none is open for the branch pair', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({ html_url: 'https://example.test/pr/7', number: 7 }, 201),
      )
    vi.stubGlobal('fetch', fetchMock)
    const pr = await upsertPullRequest(PR_CONFIG)
    expect(pr.number).toBe(7)
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.example.test/repos/fixture/release-cli/pulls?base=v1.x&head=fixture%3Anpm-publish-v1.5.1&state=open',
    )
    const create = fetchMock.mock.calls[1]!
    expect(create[0]).toBe(
      'https://api.example.test/repos/fixture/release-cli/pulls',
    )
    expect(create[1].method).toBe('POST')
    expect(JSON.parse(create[1].body)).toEqual({
      base: 'v1.x',
      body: 'fixture body',
      head: 'npm-publish-v1.5.1',
      title: 'chore(release): 1.5.1',
    })
  })

  it('refreshes the open PR on a re-run', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{ html_url: 'https://example.test/pr/7', number: 7 }]),
      )
      .mockResolvedValueOnce(
        jsonResponse({ html_url: 'https://example.test/pr/7', number: 7 }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const pr = await upsertPullRequest(PR_CONFIG)
    expect(pr.number).toBe(7)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const update = fetchMock.mock.calls[1]!
    expect(update[0]).toBe(
      'https://api.example.test/repos/fixture/release-cli/pulls/7',
    )
    expect(update[1].method).toBe('PATCH')
  })
})

describe('releasePullRequestBody', () => {
  it('tells the reviewer how to publish from the release line', () => {
    const body = releasePullRequestBody('v1.x', '1.5.1')
    expect(body).toContain('1.5.1')
    expect(body).toContain('squash-merge')
    expect(body).toContain('`v1.x`')
    expect(body).toContain('pnpm stage approve')
  })
})
