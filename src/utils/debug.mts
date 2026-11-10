/*
 * Adapted narrowly from @socketsecurity/registry 1.1.17, lib/debug.js.
 * Copyright (c) 2024 Socket Inc. Licensed under the MIT License.
 */

import util from 'node:util'

import constants from '../constants.mts'
import registryConstants from '../registry-constants.mts'
import { logger } from './logger.mts'
import { hasOwn } from './objects.mts'

type SpinnerLike = { isSpinning: boolean; start(): unknown; stop(): unknown }
type DebugOptions = { namespaces?: string; spinner?: SpinnerLike }
type NamespaceArg = string | DebugOptions

function extractOptions(value: NamespaceArg): DebugOptions {
  return typeof value === 'string' ? { namespaces: value } : value
}

function matches(pattern: string, name: string): boolean {
  if (pattern === '*') {
    return true
  }
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(name)
}

function isEnabled(namespaces?: string): boolean {
  if (!namespaces || namespaces === '*') {
    return true
  }
  const configured = process.env['DEBUG'] ?? ''
  const patterns = configured.split(/[\s,]+/).filter(Boolean)
  const requested = namespaces.split(/[\s,]+/).filter(Boolean)
  const included = patterns.filter(pattern => !pattern.startsWith('-'))
  const excluded = patterns
    .filter(pattern => pattern.startsWith('-'))
    .map(pattern => pattern.slice(1))
  const enabled = (name: string): boolean => {
    const isExcluded = excluded.some(pattern => matches(pattern, name))
    const defaultEnabled =
      !registryConstants.ENV.DEBUG &&
      registryConstants.ENV.SOCKET_CLI_DEBUG &&
      (name === 'error' || name === 'notice')
    return (
      (included.some(pattern => matches(pattern, name)) || defaultEnabled) &&
      !isExcluded
    )
  }
  const names = requested.filter(name => !name.startsWith('-'))
  const skips = requested
    .filter(name => name.startsWith('-'))
    .map(name => name.slice(1))
  return (
    (!names.length || names.some(enabled)) &&
    skips.every(name => !enabled(name))
  )
}

const defaultInspectOptions = Object.keys(process.env)
  .filter(key => /^debug_/i.test(key))
  .reduce<Record<string, unknown>>((options, key) => {
    const prop = key
      .slice(6)
      .toLowerCase()
      .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    const value = process.env[key] ?? ''
    if (/^(yes|on|true|enabled)$/i.test(value)) {
      options[prop] = true
    } else if (/^(no|off|false|disabled)$/i.test(value)) {
      options[prop] = false
    } else if (value === 'null') {
      options[prop] = null
    } else {
      options[prop] = Number(value)
    }
    return options
  }, {}) as util.InspectOptions

function withSpinner(options: DebugOptions, callback: () => void): void {
  const spinner = options.spinner ?? (constants.spinner as SpinnerLike)
  const wasSpinning = spinner.isSpinning
  spinner.stop()
  callback()
  if (wasSpinning) {
    spinner.start()
  }
}

export function isDebug(namespaces?: string): boolean {
  return registryConstants.ENV.SOCKET_CLI_DEBUG && isEnabled(namespaces)
}

export function debugDir(
  namespacesOrOpts: NamespaceArg,
  obj: unknown,
  inspectOptions?: util.InspectOptions,
): void {
  const options = extractOptions(namespacesOrOpts)
  if (!isEnabled(options.namespaces)) {
    return
  }
  withSpinner(options, () =>
    logger.dir(obj, inspectOptions ?? defaultInspectOptions),
  )
}

let pointingTriangle: string | undefined
export function debugFn(
  namespacesOrOpts: NamespaceArg,
  ...args: unknown[]
): void {
  const options = extractOptions(namespacesOrOpts)
  if (!isEnabled(options.namespaces)) {
    return
  }
  const stack = new Error().stack ?? ''
  let lineCount = 0
  let lineStart = 0
  let name = 'anonymous'
  for (let i = 0; i < stack.length; i += 1) {
    if (stack.charCodeAt(i) === 10) {
      lineCount += 1
      if (lineCount < 4) {
        lineStart = i + 1
      } else {
        const line = stack.slice(lineStart, i).trimStart()
        const match = /(?<=^at\s+).*?(?=\s+\(|$)/.exec(line)?.[0]
        if (match) {
          name = match.replace(/^(?:async|bound|get|new|set)\s+/, '')
          if (name.startsWith('Object.')) {
            const afterDot = name.slice(7)
            if (!hasOwn(Object, afterDot)) {
              name = afterDot
            }
          }
        }
        break
      }
    }
  }
  pointingTriangle ??= isUnicodeSupported() ? '▸' : '>'
  const text = args[0]
  const logArgs =
    typeof text === 'string'
      ? [
          applyLinePrefix(
            `${name ? `${name} ${pointingTriangle} ` : ''}${text}`,
            '[DEBUG] ',
          ),
          ...args.slice(1),
        ]
      : args
  withSpinner(options, () => Reflect.apply(logger.info, logger, logArgs))
}

function applyLinePrefix(value: string, prefix: string): string {
  return prefix.length
    ? `${prefix}${value.includes('\n') ? value.replace(/\n/g, `\n${prefix}`) : value}`
    : value
}

export function debugLog(
  namespacesOrOpts: NamespaceArg,
  ...args: unknown[]
): void {
  const options = extractOptions(namespacesOrOpts)
  if (!isEnabled(options.namespaces)) {
    return
  }
  withSpinner(options, () =>
    logger.info(util.formatWithOptions(defaultInspectOptions, ...args)),
  )
}

/** Structured CLI debug helpers retained from the existing Socket CLI module. */
export function debugApiRequest(
  method: string,
  endpoint: string,
  timeout?: number,
): void {
  if (constants.ENV.SOCKET_CLI_DEBUG) {
    const timeoutStr = timeout !== undefined ? ` (timeout: ${timeout}ms)` : ''
    logger.info(
      `[DEBUG] ${new Date().toISOString()} request started: ${method} ${endpoint}${timeoutStr}`,
    )
  }
}

export function debugApiResponse(
  method: string,
  endpoint: string,
  status?: number,
  error?: unknown,
  duration?: number,
  headers?: Record<string, string>,
): void {
  if (!constants.ENV.SOCKET_CLI_DEBUG) {
    return
  }
  const durationStr = duration !== undefined ? ` (${duration}ms)` : ''
  if (error) {
    logger.fail(
      `[DEBUG] ${new Date().toISOString()} request error: ${method} ${endpoint} - ${error instanceof Error ? error.message : 'Unknown error'}${durationStr}`,
    )
    if (headers) {
      logger.info(
        `[DEBUG] response headers: ${JSON.stringify(headers, null, 2)}`,
      )
    }
  } else {
    logger.info(
      `[DEBUG] ${new Date().toISOString()} request ended: ${method} ${endpoint}: HTTP ${status}${durationStr}`,
    )
    if (headers && status && status >= 400) {
      logger.info(
        `[DEBUG] response headers: ${JSON.stringify(headers, null, 2)}`,
      )
    }
  }
}

export function debugFileOp(
  operation: 'read' | 'write' | 'delete' | 'create',
  filepath: string,
  error?: unknown,
): void {
  if (error) {
    debugDir('warn', {
      operation,
      filepath,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  } else if (isDebug('silly')) {
    debugFn('silly', `File ${operation}: ${filepath}`)
  }
}

export function debugScan(
  phase: 'start' | 'progress' | 'complete' | 'error',
  packageCount?: number,
  details?: unknown,
): void {
  switch (phase) {
    case 'start':
      if (packageCount) {
        debugFn('notice', `Scanning ${packageCount} packages`)
      }
      break
    case 'progress':
      if (isDebug('silly') && packageCount) {
        debugFn('silly', `Scan progress: ${packageCount} packages processed`)
      }
      break
    case 'complete':
      debugFn(
        'notice',
        `Scan complete${packageCount ? `: ${packageCount} packages` : ''}`,
      )
      break
    case 'error':
      debugDir('error', { phase: 'scan_error', details })
      break
  }
}

export function debugConfig(
  source: string,
  found: boolean,
  error?: unknown,
): void {
  if (error) {
    debugDir('warn', {
      source,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  } else if (found) {
    debugFn('notice', `Config loaded: ${source}`)
  } else if (isDebug('silly')) {
    debugFn('silly', `Config not found: ${source}`)
  }
}

export function debugGit(
  operation: string,
  success: boolean,
  details?: Record<string, unknown>,
): void {
  if (!success) {
    debugDir('warn', { git_op: operation, ...details })
  } else if (
    (isDebug('notice') && operation.includes('push')) ||
    operation.includes('commit')
  ) {
    debugFn('notice', `Git ${operation} succeeded`)
  } else if (isDebug('silly')) {
    debugFn('silly', `Git ${operation}`)
  }
}

function isUnicodeSupported(): boolean {
  if (process.platform !== 'win32') {
    return process.env['TERM'] !== 'linux'
  }
  const { env } = process
  return !!(
    env['WT_SESSION'] ||
    env['TERMINUS_SUBLIME'] ||
    env['ConEmuTask'] === '{cmd::Cmder}' ||
    env['TERM_PROGRAM'] === 'Terminus-Sublime' ||
    env['TERM_PROGRAM'] === 'vscode' ||
    env['TERM'] === 'xterm-256color' ||
    env['TERM'] === 'alacritty' ||
    env['TERM'] === 'rxvt-unicode' ||
    env['TERM'] === 'rxvt-unicode-256color' ||
    env['TERMINAL_EMULATOR'] === 'JetBrains-JediTerm'
  )
}
