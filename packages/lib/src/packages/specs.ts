/**
 * @fileoverview Package spec parsing and GitHub URL utilities.
 */

import { isObjectObject } from '../objects'
import { isNonEmptyString } from '../strings'

let _npmPackageArg: typeof import('npm-package-arg') | undefined
/**
 * Get the npm-package-arg module.
 */
/*@__NO_SIDE_EFFECTS__*/
function getNpmPackageArg() {
  if (_npmPackageArg === undefined) {
    _npmPackageArg = /*@__PURE__*/ require('npm-package-arg')
  }
  return _npmPackageArg as typeof import('npm-package-arg')
}

/**
 * Extract user and project from GitHub repository URL.
 */
/*@__NO_SIDE_EFFECTS__*/
export function getRepoUrlDetails(repoUrl: string = ''): {
  user: string
  project: string
} {
  const userAndRepo = repoUrl.replace(/^.+github.com\//, '').split('/')
  const user = userAndRepo[0] || ''
  const project =
    userAndRepo.length > 1 ? userAndRepo[1]?.slice(0, -'.git'.length) || '' : ''
  return { user, project }
}

/**
 * Generate GitHub API URL for a tag reference.
 */
/*@__NO_SIDE_EFFECTS__*/
export function gitHubTagRefUrl(
  user: string,
  project: string,
  tag: string,
): string {
  return `https://api.github.com/repos/${user}/${project}/git/ref/tags/${tag}`
}

/**
 * Generate GitHub tarball download URL for a commit SHA.
 */
/*@__NO_SIDE_EFFECTS__*/
export function gitHubTgzUrl(
  user: string,
  project: string,
  sha: string,
): string {
  return `https://github.com/${user}/${project}/archive/${sha}.tar.gz`
}

/**
 * Check if a package specifier is a GitHub tarball URL.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isGitHubTgzSpec(spec: unknown, where?: string): boolean {
  let parsedSpec: unknown
  if (isObjectObject(spec)) {
    parsedSpec = spec
  } else {
    const npmPackageArg = getNpmPackageArg()
    parsedSpec = npmPackageArg(spec as string, where)
  }
  const typedSpec = parsedSpec as { type?: string; saveSpec?: string }
  return (
    typedSpec.type === 'remote' && !!typedSpec.saveSpec?.endsWith('.tar.gz')
  )
}

/**
 * Check if a package specifier is a GitHub URL with committish.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isGitHubUrlSpec(spec: unknown, where?: string): boolean {
  let parsedSpec: unknown
  if (isObjectObject(spec)) {
    parsedSpec = spec
  } else {
    const npmPackageArg = getNpmPackageArg()
    parsedSpec = npmPackageArg(spec as string, where)
  }
  const typedSpec = parsedSpec as {
    gitCommittish?: string
    hosted?: { domain?: string }
    type?: string
  }
  return (
    typedSpec.type === 'git' &&
    typedSpec.hosted?.domain === 'github.com' &&
    isNonEmptyString(typedSpec.gitCommittish)
  )
}
