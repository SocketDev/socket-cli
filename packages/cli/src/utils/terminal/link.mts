import path from 'node:path'

import terminalLink from 'terminal-link'

import { SOCKET_WEBSITE_URL } from '../../constants/socket.mts'

/**
 * Creates a terminal link to a local file.
 */
export function fileLink(filePath: string, text?: string | undefined): string {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(filePath)
  return terminalLink(text ?? filePath, `file://${absolutePath}`)
}

/**
 * Creates a terminal link to an email address.
 */
export function mailtoLink(email: string, text?: string | undefined): string {
  return terminalLink(text ?? email, `mailto:${email}`)
}

/**
 * Creates a terminal link to the Socket.dev dashboard.
 */
export function socketDashboardLink(
  dashPath: string,
  text?: string | undefined,
): string {
  const url = `https://socket.dev/dashboard${dashPath.startsWith('/') ? dashPath : `/${dashPath}`}`
  return terminalLink(text ?? url, url)
}

/**
 * Creates a terminal link to the Socket.dev website.
 */
export function socketDevLink(
  text?: string | undefined,
  urlPath?: string | undefined,
): string {
  return terminalLink(
    text ?? 'Socket.dev',
    `${SOCKET_WEBSITE_URL}${urlPath || ''}`,
  )
}

/**
 * Creates a terminal link to Socket.dev documentation.
 */
export function socketDocsLink(
  docPath: string,
  text?: string | undefined,
): string {
  const url = `https://docs.socket.dev${docPath.startsWith('/') ? docPath : `/${docPath}`}`
  return terminalLink(text ?? url, url)
}

/**
 * Creates a terminal link to Socket.dev package page.
 */
export function socketPackageLink(
  ecosystem: string,
  packageName: string,
  version?: string | undefined,
  text?: string | undefined,
): string {
  let url: string
  if (version) {
    // Check if version contains a path like 'files/1.0.0/CHANGELOG.md'.
    if (version.includes('/')) {
      url = `https://socket.dev/${ecosystem}/package/${packageName}/${version}`
    } else {
      url = `https://socket.dev/${ecosystem}/package/${packageName}/overview/${version}`
    }
  } else {
    url = `https://socket.dev/${ecosystem}/package/${packageName}`
  }
  return terminalLink(text ?? url, url)
}

/**
 * Creates a terminal link to a GitHub repository.
 */
export function githubRepoLink(
  owner: string,
  repo: string,
  path?: string | undefined,
  text?: string | undefined,
): string {
  const url = `https://github.com/${owner}/${repo}${path ? `/${path}` : ''}`
  return terminalLink(text ?? `${owner}/${repo}`, url)
}

/**
 * Creates a terminal link to a web URL.
 */
export function webLink(url: string, text?: string | undefined): string {
  return terminalLink(text ?? url, url)
}
