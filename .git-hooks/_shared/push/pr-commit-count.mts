import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

interface OpenPr {
  baseRefName?: string | undefined
  headRefName?: string | undefined
}

export function checkPrCommitSignatures(
  remote: string,
  baseRefName: string,
  localSha: string,
  branch: string,
  commits: number,
): string | undefined {
  // Git prints one revision per line; accept LF and CRLF.
  if (commits > 1) {
    const listedCommits = spawnSync(
      'git',
      ['rev-list', '--reverse', `${remote}/${baseRefName}..${localSha}`],
      { encoding: 'utf8', timeout: 5000 },
    )
    const shas = String(listedCommits.stdout ?? '')
      .trim()
      .split(/\r?\n/)
    if (
      listedCommits.status !== 0 ||
      shas.length !== commits ||
      shas.some(sha => !sha)
    ) {
      return `PR branch ${branch}: cannot list commits; fetch ${remote} and retry.`
    }
    for (let i = 0, { length } = shas; i < length; i += 1) {
      const sha = shas[i]!
      const verified = spawnSync('git', ['verify-commit', sha], {
        encoding: 'utf8',
        timeout: 5000,
      })
      if (verified.status !== 0) {
        return `PR branch ${branch}: commit ${sha.slice(0, 12)} has no valid signature; sign each commit before pushing.`
      }
    }
  }
  return undefined
}

export function checkPrCommitCount(
  remote: string,
  localSha: string,
  remoteRef: string,
): string | undefined {
  // An all-zero source ID is Git's branch-deletion sentinel.
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
    if (commits < 1) {
      return `PR branch ${branch}: expected at least one commit above ${pr.baseRefName}, found ${commits}.`
    }
    const signatureError = checkPrCommitSignatures(
      remote,
      pr.baseRefName,
      localSha,
      branch,
      commits,
    )
    if (signatureError) {
      return signatureError
    }
  }
  return undefined
}
