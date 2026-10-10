import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

interface OpenPr {
  baseRefName?: string | undefined
  headRefName?: string | undefined
}

export function checkPrCommitCount(
  remote: string,
  localSha: string,
  remoteRef: string,
): string | undefined {
  if (!remoteRef.startsWith('refs/heads/') || /^0+$/u.test(localSha)) {
    return undefined
  }
  const branch = remoteRef.slice('refs/heads/'.length)
  const listed = spawnSync(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'open',
      '--head',
      branch,
      '--json',
      'baseRefName,headRefName',
      '--limit',
      '2',
    ],
    { encoding: 'utf8', timeout: 5000 },
  )
  if (listed.status !== 0) {
    return undefined
  }
  let prs: OpenPr[]
  try {
    const parsed: unknown = JSON.parse(String(listed.stdout))
    if (!Array.isArray(parsed)) {
      return undefined
    }
    prs = parsed as OpenPr[]
  } catch {
    return undefined
  }
  for (let i = 0, { length } = prs; i < length; i += 1) {
    const pr = prs[i]!
    if (pr.headRefName !== branch || !pr.baseRefName) {
      continue
    }
    const counted = spawnSync(
      'git',
      ['rev-list', '--count', `${remote}/${pr.baseRefName}..${localSha}`],
      { encoding: 'utf8', timeout: 5000 },
    )
    const commits = Number(String(counted.stdout ?? '').trim())
    if (counted.status !== 0 || !Number.isSafeInteger(commits)) {
      return `PR branch ${branch}: cannot count commits above ${pr.baseRefName}; fetch ${remote} and retry.`
    }
    if (commits !== 1) {
      return `PR branch ${branch}: expected one commit above ${pr.baseRefName}, found ${commits}; squash onto the PR base before pushing.`
    }
  }
  return undefined
}
