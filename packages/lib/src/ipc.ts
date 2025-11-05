/**
 * IPC (Inter-Process Communication) Module
 * ==========================================
 *
 * This module provides secure inter-process communication utilities for Socket CLI
 * and related tools. It replaces environment variable passing with more secure and
 * scalable alternatives.
 *
 * ## Key Features:
 * - File-based stub communication for initial data handoff
 * - Node.js IPC channel support for real-time bidirectional messaging
 * - Automatic cleanup of temporary files
 * - Type-safe message validation with Zod schemas
 * - Timeout handling for reliability
 *
 * ## Use Cases:
 * 1. Passing API tokens between processes without exposing them in env vars
 * 2. Transferring large configuration objects that exceed env var size limits
 * 3. Bidirectional communication between parent and child processes
 * 4. Secure handshake protocols between Socket CLI components
 *
 * ## Security Considerations:
 * - Stub files are created with restricted permissions in OS temp directory
 * - Messages include timestamps for freshness validation
 * - Automatic cleanup prevents sensitive data persistence
 * - Unique IDs prevent message replay attacks
 *
 * @module ipc
 */

import crypto from 'crypto'

import { promises as fs } from 'fs'

import path from 'path'

import { safeDeleteSync } from './fs'
import { getOsTmpDir } from './paths'
import { z } from './zod'

// Define BufferEncoding type for TypeScript compatibility.
type BufferEncoding = globalThis.BufferEncoding

/**
 * Zod Schemas for Runtime Validation
 * ====================================
 * These schemas provide runtime type safety for IPC messages,
 * ensuring data integrity across process boundaries.
 */

/**
 * Base IPC message schema - validates the core message structure.
 * All IPC messages must conform to this schema.
 */
const IpcMessageSchema = z.object({
  /** Unique identifier for message tracking and response correlation. */
  id: z.string().min(1),
  /** Unix timestamp for freshness validation and replay prevention. */
  timestamp: z.number().positive(),
  /** Message type identifier for routing and handling. */
  type: z.string().min(1),
  /** Payload data - can be any JSON-serializable value. */
  data: z.unknown(),
})

/**
 * IPC handshake schema - used for initial connection establishment.
 * The handshake includes version info and authentication tokens.
 * @internal Exported for testing purposes.
 */
export const IpcHandshakeSchema = IpcMessageSchema.extend({
  type: z.literal('handshake'),
  data: z.object({
    /** Protocol version for compatibility checking. */
    version: z.string(),
    /** Process ID for identification. */
    pid: z.number().int().positive(),
    /** Optional API token for authentication. */
    apiToken: z.string().optional(),
    /** Application name for multi-app support. */
    appName: z.string(),
  }),
})

/**
 * IPC stub file schema - validates the structure of stub files.
 * Stub files are used for passing data between processes via filesystem.
 */
const IpcStubSchema = z.object({
  /** Process ID that created the stub. */
  pid: z.number().int().positive(),
  /** Creation timestamp for age validation. */
  timestamp: z.number().positive(),
  /** The actual data payload. */
  data: z.unknown(),
})

/**
 * TypeScript interfaces for IPC communication.
 * These types ensure type consistency across the IPC module.
 */

/**
 * Base IPC message interface.
 * All IPC messages must conform to this structure.
 */
export interface IpcMessage<T = unknown> {
  /** Unique identifier for message tracking and response correlation. */
  id: string
  /** Unix timestamp for freshness validation and replay prevention. */
  timestamp: number
  /** Message type identifier for routing and handling. */
  type: string
  /** Payload data - can be any JSON-serializable value. */
  data: T
}

/**
 * IPC handshake message interface.
 * Used for initial connection establishment.
 */
export interface IpcHandshake
  extends IpcMessage<{
    /** Protocol version for compatibility checking. */
    version: string
    /** Process ID for identification. */
    pid: number
    /** Optional API token for authentication. */
    apiToken?: string
    /** Application name for multi-app support. */
    appName: string
  }> {
  type: 'handshake'
}

/**
 * IPC stub file interface.
 * Represents the structure of stub files used for filesystem-based IPC.
 */
export interface IpcStub {
  /** Process ID that created the stub. */
  pid: number
  /** Creation timestamp for age validation. */
  timestamp: number
  /** The actual data payload. */
  data: unknown
}

/**
 * Options for IPC communication
 */
export interface IpcOptions {
  /** Timeout in milliseconds for async operations. */
  timeout?: number
  /** Text encoding for message serialization. */
  encoding?: BufferEncoding
}

/**
 * Create a unique IPC channel identifier for message correlation.
 *
 * Generates a unique identifier that combines:
 * - A prefix for namespacing (defaults to 'socket')
 * - The current process ID for process identification
 * - A random hex string for uniqueness
 *
 * @param prefix - Optional prefix to namespace the channel ID
 * @returns A unique channel identifier string
 *
 * @example
 * ```typescript
 * const channelId = createIpcChannelId('socket-cli')
 * // Returns: 'socket-cli-12345-a1b2c3d4e5f6g7h8'
 * ```
 */
export function createIpcChannelId(prefix = 'socket'): string {
  return `${prefix}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
}

/**
 * Get the IPC stub path for a given application.
 *
 * This function generates a unique file path for IPC stub files that are used
 * to pass data between processes. The stub files are stored in a hidden directory
 * within the system's temporary folder.
 *
 * ## Path Structure:
 * - Base: System temp directory (e.g., /tmp on Unix, %TEMP% on Windows)
 * - Directory: `.socket-ipc/{appName}/`
 * - Filename: `stub-{pid}.json`
 *
 * ## Security Features:
 * - Files are isolated per application via appName parameter
 * - Process ID in filename prevents collisions between concurrent processes
 * - Temporary directory location ensures automatic cleanup on system restart
 *
 * @param appName - The application identifier (e.g., 'socket-cli', 'socket-dlx')
 * @returns Full path to the IPC stub file
 *
 * @example
 * ```typescript
 * const stubPath = getIpcStubPath('socket-cli')
 * // Returns: '/tmp/.socket-ipc/socket-cli/stub-12345.json' (Unix)
 * // Returns: 'C:\\Users\\Name\\AppData\\Local\\Temp\\.socket-ipc\\socket-cli\\stub-12345.json' (Windows)
 * ```
 *
 * @used Currently used by socket-cli for self-update and inter-process communication
 */
export function getIpcStubPath(appName: string): string {
  // Get the system's temporary directory - this is platform-specific.
  const tempDir = getOsTmpDir()

  // Create a hidden directory structure for Socket IPC files.
  // The dot prefix makes it hidden on Unix-like systems.
  const stubDir = path.join(tempDir, '.socket-ipc', appName)

  // Generate filename with process ID to ensure uniqueness.
  // The PID prevents conflicts when multiple processes run simultaneously.
  return path.join(stubDir, `stub-${process.pid}.json`)
}

/**
 * Ensure IPC directory exists for stub file creation.
 *
 * This helper function creates the directory structure needed for IPC stub files.
 * It's called before writing stub files to ensure the parent directories exist.
 *
 * @param filePath - Full path to the file that needs its directory created
 * @returns Promise that resolves when directory is created
 *
 * @internal Helper function used by writeIpcStub
 */
async function ensureIpcDirectory(filePath: string): Promise<void> {
  const dir = path.dirname(filePath)
  // Create directory recursively if it doesn't exist.
  await fs.mkdir(dir, { recursive: true })
}

/**
 * Write IPC data to a stub file for inter-process data transfer.
 *
 * This function creates a stub file containing data that needs to be passed
 * between processes. The stub file includes metadata like process ID and
 * timestamp for validation.
 *
 * ## File Structure:
 * ```json
 * {
 *   "pid": 12345,
 *   "timestamp": 1699564234567,
 *   "data": { ... }
 * }
 * ```
 *
 * ## Use Cases:
 * - Passing API tokens to child processes
 * - Transferring configuration between Socket CLI components
 * - Sharing large data that exceeds environment variable limits
 *
 * @param appName - The application identifier
 * @param data - The data to write to the stub file
 * @returns Promise resolving to the stub file path
 *
 * @example
 * ```typescript
 * const stubPath = await writeIpcStub('socket-cli', {
 *   apiToken: 'secret-token',
 *   config: { ... }
 * })
 * // Pass stubPath to child process for reading
 * ```
 */
export async function writeIpcStub(
  appName: string,
  data: unknown,
): Promise<string> {
  const stubPath = getIpcStubPath(appName)
  await ensureIpcDirectory(stubPath)

  // Create stub data with validation metadata.
  const ipcData: IpcStub = {
    data,
    pid: process.pid,
    timestamp: Date.now(),
  }

  // Validate data structure with Zod schema.
  const validated = IpcStubSchema.parse(ipcData)

  // Write with pretty printing for debugging.
  await fs.writeFile(stubPath, JSON.stringify(validated, null, 2), 'utf8')
  return stubPath
}

/**
 * Read IPC data from a stub file with automatic cleanup.
 *
 * This function reads data from an IPC stub file and validates its freshness.
 * Stale files (older than 5 minutes) are automatically cleaned up to prevent
 * accumulation of temporary files.
 *
 * ## Validation Steps:
 * 1. Read and parse JSON file
 * 2. Validate structure with Zod schema
 * 3. Check timestamp freshness
 * 4. Clean up if stale
 * 5. Return data if valid
 *
 * @param stubPath - Path to the stub file to read
 * @returns Promise resolving to the data or null if invalid/stale
 *
 * @example
 * ```typescript
 * const data = await readIpcStub('/tmp/.socket-ipc/socket-cli/stub-12345.json')
 * if (data) {
 *   console.log('Received:', data)
 * }
 * ```
 *
 * @unused Reserved for future implementation
 */
export async function readIpcStub(stubPath: string): Promise<unknown> {
  try {
    const content = await fs.readFile(stubPath, 'utf8')
    const parsed = JSON.parse(content)
    // Validate structure with Zod schema.
    const validated = IpcStubSchema.parse(parsed)
    // Check age for freshness validation.
    const ageMs = Date.now() - validated.timestamp
    // 5 minutes.
    const maxAgeMs = 5 * 60 * 1000
    if (ageMs > maxAgeMs) {
      // Clean up stale file. IPC stubs are always in tmpdir, so use force: true.
      try {
        safeDeleteSync(stubPath, { force: true })
      } catch {
        // Ignore deletion errors
      }
      return null
    }
    return validated.data
  } catch {
    // Return null for any errors (file not found, invalid JSON, validation failure).
    return null
  }
}

/**
 * Clean up IPC stub files for an application.
 *
 * This maintenance function removes stale IPC stub files to prevent
 * accumulation in the temporary directory. It's designed to be called
 * periodically or on application startup.
 *
 * ## Cleanup Rules:
 * - Files older than 5 minutes are removed (checked via both filesystem mtime and JSON timestamp)
 * - Only stub files (stub-*.json) are processed
 * - Errors are silently ignored (best-effort cleanup)
 *
 * @param appName - The application identifier
 * @returns Promise that resolves when cleanup is complete
 *
 * @example
 * ```typescript
 * // Clean up on application startup
 * await cleanupIpcStubs('socket-cli')
 * ```
 *
 * @unused Reserved for future implementation
 */
export async function cleanupIpcStubs(appName: string): Promise<void> {
  const tempDir = getOsTmpDir()
  const stubDir = path.join(tempDir, '.socket-ipc', appName)
  try {
    const files = await fs.readdir(stubDir)
    const now = Date.now()
    // 5 minutes.
    const maxAgeMs = 5 * 60 * 1000
    // Process each file in parallel for efficiency.
    await Promise.allSettled(
      files.map(async file => {
        if (file.startsWith('stub-') && file.endsWith('.json')) {
          const filePath = path.join(stubDir, file)
          try {
            // Check both filesystem mtime and JSON timestamp for more reliable detection
            const stats = await fs.stat(filePath)
            const mtimeAge = now - stats.mtimeMs
            let isStale = mtimeAge > maxAgeMs

            // Always check the timestamp inside the JSON file for accuracy
            // This is more reliable than filesystem mtime in some environments
            try {
              const content = await fs.readFile(filePath, 'utf8')
              const parsed = JSON.parse(content)
              const validated = IpcStubSchema.parse(parsed)
              const contentAge = now - validated.timestamp
              // File is stale if EITHER check indicates staleness
              isStale = isStale || contentAge > maxAgeMs
            } catch {
              // If we can't read/parse the file, rely on mtime check
            }

            if (isStale) {
              // IPC stubs are always in tmpdir, so we can use force: true to skip path checks
              safeDeleteSync(filePath, { force: true })
            }
          } catch {
            // Ignore errors for individual files.
          }
        }
      }),
    )
  } catch {
    // Directory might not exist, that's ok.
  }
}

/**
 * Send data through Node.js IPC channel.
 *
 * This function sends structured messages through the Node.js IPC channel
 * when available. The IPC channel must be established with stdio: ['pipe', 'pipe', 'pipe', 'ipc'].
 *
 * ## Requirements:
 * - Process must have been spawned with IPC channel enabled
 * - Message must be serializable to JSON
 * - Process.send() must be available
 *
 * @param process - The process object with IPC channel
 * @param message - The IPC message to send
 * @returns true if message was sent, false otherwise
 *
 * @example
 * ```typescript
 * const message = createIpcMessage('handshake', { version: '1.0.0' })
 * const sent = sendIpc(childProcess, message)
 * ```
 *
 * @unused Reserved for bidirectional communication implementation
 */
export function sendIpc(
  process: NodeJS.Process | unknown,
  message: IpcMessage,
): boolean {
  if (
    process &&
    typeof process === 'object' &&
    'send' in process &&
    typeof process.send === 'function'
  ) {
    try {
      // Validate message structure before sending.
      const validated = IpcMessageSchema.parse(message)
      return process.send(validated)
    } catch {
      return false
    }
  }
  return false
}

/**
 * Receive data through Node.js IPC channel.
 *
 * Sets up a listener for IPC messages with automatic validation and parsing.
 * Returns a cleanup function to remove the listener when no longer needed.
 *
 * ## Message Flow:
 * 1. Receive raw message from IPC channel
 * 2. Validate with parseIpcMessage
 * 3. Call handler if valid
 * 4. Ignore invalid messages
 *
 * @param handler - Function to call with valid IPC messages
 * @returns Cleanup function to remove the listener
 *
 * @example
 * ```typescript
 * const cleanup = onIpc((message) => {
 *   console.log('Received:', message.type, message.data)
 * })
 * // Later...
 * cleanup() // Remove listener
 * ```
 *
 * @unused Reserved for bidirectional communication
 */
export function onIpc(handler: (message: IpcMessage) => void): () => void {
  const listener = (message: unknown) => {
    const parsed = parseIpcMessage(message)
    if (parsed) {
      handler(parsed)
    }
  }
  process.on('message', listener)
  // Return cleanup function for proper resource management.
  return () => {
    process.off('message', listener)
  }
}

/**
 * Create a promise that resolves when a specific IPC message is received.
 *
 * This utility function provides async/await support for IPC communication,
 * allowing you to wait for specific message types with timeout support.
 *
 * ## Features:
 * - Automatic timeout handling
 * - Type-safe message data
 * - Resource cleanup on completion
 * - Promise-based API
 *
 * @param messageType - The message type to wait for
 * @param options - Options including timeout configuration
 * @returns Promise resolving to the message data
 *
 * @example
 * ```typescript
 * try {
 *   const response = await waitForIpc<ConfigData>('config-response', {
 *     timeout: 5000 // 5 seconds
 *   })
 *   console.log('Config received:', response)
 * } catch (error) {
 *   console.error('Timeout waiting for config')
 * }
 * ```
 *
 * @unused Reserved for request-response pattern implementation
 */
export function waitForIpc<T = unknown>(
  messageType: string,
  options: IpcOptions = {},
): Promise<T> {
  const { timeout = 30_000 } = options
  return new Promise((resolve, reject) => {
    let cleanup: (() => void) | null = null
    let timeoutId: NodeJS.Timeout | null = null
    const handleTimeout = () => {
      if (cleanup) {
        cleanup()
      }
      reject(new Error(`IPC timeout waiting for message type: ${messageType}`))
    }
    const handleMessage = (message: IpcMessage) => {
      if (message.type === messageType) {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        if (cleanup) {
          cleanup()
        }
        resolve(message.data as T)
      }
    }
    cleanup = onIpc(handleMessage)
    if (timeout > 0) {
      timeoutId = setTimeout(handleTimeout, timeout)
    }
  })
}

/**
 * Create an IPC message with proper structure and metadata.
 *
 * This factory function creates properly structured IPC messages with:
 * - Unique ID for tracking
 * - Timestamp for freshness
 * - Type for routing
 * - Data payload
 *
 * @param type - The message type identifier
 * @param data - The message payload
 * @returns A properly structured IPC message
 *
 * @example
 * ```typescript
 * const handshake = createIpcMessage('handshake', {
 *   version: '1.0.0',
 *   pid: process.pid,
 *   appName: 'socket-cli'
 * })
 * ```
 *
 * @unused Reserved for future message creation needs
 */
export function createIpcMessage<T = unknown>(
  type: string,
  data: T,
): IpcMessage<T> {
  return {
    id: crypto.randomBytes(16).toString('hex'),
    timestamp: Date.now(),
    type,
    data,
  }
}

/**
 * Check if process has IPC channel available.
 *
 * This utility checks whether a process object has the necessary
 * properties for IPC communication. Used to determine if IPC
 * messaging is possible before attempting to send.
 *
 * @param process - The process object to check
 * @returns true if IPC is available, false otherwise
 *
 * @example
 * ```typescript
 * if (hasIpcChannel(childProcess)) {
 *   sendIpc(childProcess, message)
 * } else {
 *   // Fall back to alternative communication method
 * }
 * ```
 *
 * @unused Reserved for IPC availability detection
 */
export function hasIpcChannel(process: unknown): boolean {
  return Boolean(
    process &&
      typeof process === 'object' &&
      'send' in process &&
      typeof process.send === 'function' &&
      'channel' in process &&
      process.channel !== undefined,
  )
}

/**
 * Safely parse and validate IPC messages.
 *
 * This function performs runtime validation of incoming messages
 * to ensure they conform to the IPC message structure. It uses
 * Zod schemas for robust validation.
 *
 * ## Validation Steps:
 * 1. Check if message is an object
 * 2. Validate required fields exist
 * 3. Validate field types
 * 4. Return typed message or null
 *
 * @param message - The raw message to parse
 * @returns Parsed IPC message or null if invalid
 *
 * @example
 * ```typescript
 * const parsed = parseIpcMessage(rawMessage)
 * if (parsed) {
 *   handleMessage(parsed)
 * }
 * ```
 *
 * @unused Reserved for message validation needs
 */
export function parseIpcMessage(message: unknown): IpcMessage | null {
  try {
    // Use Zod schema for comprehensive validation.
    const validated = IpcMessageSchema.parse(message)
    return validated as IpcMessage
  } catch {
    // Return null for any validation failure.
    return null
  }
}
