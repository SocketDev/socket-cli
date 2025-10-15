/** @fileoverview Command-scoped logger for Socket CLI. Provides logging with automatic command context for better debugging and filtering. */

import { logger } from '@socketsecurity/registry/lib/logger'

/**
 * Logger with command context
 */
export interface CommandLogger {
  /**
   * Log an informational message
   */
  log: (...args: any[]) => void

  /**
   * Log an info message
   */
  info: (...args: any[]) => void

  /**
   * Log a warning message
   */
  warn: (...args: any[]) => void

  /**
   * Log an error message
   */
  error: (...args: any[]) => void

  /**
   * Log a failure message with badge
   */
  fail: (...args: any[]) => void

  /**
   * Log a success message with badge
   */
  success: (...args: any[]) => void

  /**
   * Get the command name
   */
  readonly commandName: string
}

/**
 * Creates a command-scoped logger that prefixes all messages with the command name
 *
 * @param commandName - The name of the command (e.g., 'scan:create', 'repository:delete')
 * @param options - Optional configuration
 * @returns A logger instance with command context
 *
 * @example
 * const log = createCommandLogger('repository:delete')
 * log.info('Deleting repository...') // Logs: [repository:delete] Deleting repository...
 */
export function createCommandLogger(
  commandName: string,
  options: {
    /**
     * Whether to include the command name prefix in logs
     * @default true
     */
    includePrefix?: boolean
    /**
     * Custom prefix format function
     * @default (name) => `[${name}]`
     */
    formatPrefix?: (commandName: string) => string
  } = {},
): CommandLogger {
  const { formatPrefix = name => `[${name}]`, includePrefix = true } = options

  const prefix = includePrefix ? formatPrefix(commandName) : ''

  const prefixArgs = (...args: any[]): any[] => {
    if (!prefix) {
      return args
    }
    return [prefix, ...args]
  }

  return {
    log: (...args: any[]) => logger.log(...prefixArgs(...args)),
    info: (...args: any[]) => logger.info(...prefixArgs(...args)),
    warn: (...args: any[]) => logger.warn(...prefixArgs(...args)),
    error: (...args: any[]) => logger.error(...prefixArgs(...args)),
    fail: (...args: any[]) => logger.fail(...prefixArgs(...args)),
    success: (...args: any[]) => logger.success(...prefixArgs(...args)),
    commandName,
  }
}

/**
 * Creates a scoped logger for a specific operation within a command
 *
 * @param commandLogger - The command logger to scope
 * @param operationName - The operation name (e.g., 'fetch', 'validate', 'output')
 * @returns A logger with operation context
 *
 * @example
 * const log = createCommandLogger('scan:create')
 * const fetchLog = createOperationLogger(log, 'fetch')
 * fetchLog.info('Fetching scan data...') // Logs: [scan:create] [fetch] Fetching scan data...
 */
export function createOperationLogger(
  commandLogger: CommandLogger,
  operationName: string,
): CommandLogger {
  return createCommandLogger(`${commandLogger.commandName}:${operationName}`, {
    includePrefix: true,
  })
}

/**
 * Global logger instance (re-exported for convenience)
 */
export { logger }

/**
 * Create a logger for debugging purposes
 * Only logs when DEBUG environment variable matches the namespace
 *
 * @param namespace - Debug namespace (e.g., 'socket:cli:scan')
 * @returns A debug logger function
 *
 * @example
 * const debug = createDebugLogger('socket:cli:scan')
 * debug('Scanning directory...') // Only logs if DEBUG=socket:cli:scan
 */
export function createDebugLogger(namespace: string): (...args: any[]) => void {
  const debugEnv = process.env['DEBUG']
  const enabled =
    debugEnv === '*' ||
    debugEnv?.split(',').some(ns => {
      const pattern = ns.trim().replace(/\*/g, '.*')
      return new RegExp(`^${pattern}$`).test(namespace)
    })

  if (!enabled) {
    return () => {}
  }

  return (...args: any[]) => {
    logger.log(`[${namespace}]`, ...args)
  }
}

/**
 * Logger factory for creating consistent command loggers
 */
export class LoggerFactory {
  private static instances = new Map<string, CommandLogger>()

  /**
   * Get or create a command logger
   *
   * @param commandName - The command name
   * @returns A cached or new command logger
   */
  static getLogger(commandName: string): CommandLogger {
    if (!this.instances.has(commandName)) {
      this.instances.set(commandName, createCommandLogger(commandName))
    }
    return this.instances.get(commandName)!
  }

  /**
   * Clear all cached loggers
   */
  static clear(): void {
    this.instances.clear()
  }
}
