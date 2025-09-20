import path from 'node:path'

import terminalLink from 'terminal-link'

import { SOCKET_WEBSITE_URL } from '../constants.mts'

/**
 * Creates a terminal link to a local file.
 * @param filePath The file path to link to
 * @param text Optional display text (defaults to the file path itself)
 * @returns A terminal link to the file
 */
export function fileLink(filePath: string, text?: string | undefined): string {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(filePath)
  return terminalLink(text ?? filePath, `file://${absolutePath}`)
}

/**
 * Creates a terminal link to an email address.
 * @param email The email address
 * @param text Optional display text (defaults to the email address itself)
 * @returns A terminal link to compose an email
 */
export function mailtoLink(email: string, text?: string | undefined): string {
  return terminalLink(text ?? email, `mailto:${email}`)
}

/**
 * Creates a terminal link to the Socket.dev dashboard.
 * @param path The path within the dashboard (e.g., '/org/YOURORG/alerts')
 * @param text Optional display text
 * @returns A terminal link to the Socket.dev dashboard URL
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
 * @param text Display text for the link (defaults to 'Socket.dev')
 * @param urlPath Optional path to append to the base URL (e.g., '/pricing')
 * @returns A terminal link to Socket.dev
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
 * @param docPath The documentation path (e.g., '/docs/api-keys')
 * @param text Optional display text
 * @returns A terminal link to the Socket.dev documentation
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
 * @param ecosystem The package ecosystem (e.g., 'npm')
 * @param packageName The package name
 * @param version Optional package version or path (e.g., 'files/1.0.0/CHANGELOG.md')
 * @param text Optional display text
 * @returns A terminal link to the Socket.dev package page
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
 * Creates a terminal link to a web URL.
 * @param url The web URL to link to
 * @param text Optional display text (defaults to the URL itself)
 * @returns A terminal link to the URL
 */
export function webLink(url: string, text?: string | undefined): string {
  return terminalLink(text ?? url, url)
}
