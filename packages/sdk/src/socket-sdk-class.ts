/**
 * @fileoverview SocketSdk class implementation for Socket security API client.
 * Provides complete API functionality for vulnerability scanning, analysis, and reporting.
 */
import { createWriteStream } from 'node:fs'
import readline from 'node:readline'

import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
import { UNKNOWN_ERROR } from '@socketsecurity/lib/constants/core'
import { getAbortSignal } from '@socketsecurity/lib/constants/process'
import { SOCKET_PUBLIC_API_TOKEN } from '@socketsecurity/lib/constants/socket'
import { debugLog, isDebugNs } from '@socketsecurity/lib/debug'
import { validateFiles } from '@socketsecurity/lib/fs'
import { jsonParse } from '@socketsecurity/lib/json'
import { getOwn, isObjectObject } from '@socketsecurity/lib/objects'
import { pRetry } from '@socketsecurity/lib/promises'
import { setMaxEventTargetListeners } from '@socketsecurity/lib/suppress-warnings'
import { urlSearchParamAsBoolean } from '@socketsecurity/lib/url'

const abortSignal = getAbortSignal()

import {
  DEFAULT_HTTP_TIMEOUT,
  DEFAULT_RETRIES,
  DEFAULT_RETRY_DELAY,
  DEFAULT_USER_AGENT,
  httpAgentNames,
  MAX_HTTP_TIMEOUT,
  MAX_STREAM_SIZE,
  MIN_HTTP_TIMEOUT,
  SOCKET_API_TOKENS_URL,
  SOCKET_CONTACT_URL,
  SOCKET_DASHBOARD_URL,
  SOCKET_PUBLIC_BLOB_STORE_URL,
} from './constants'
import {
  createRequestBodyForFilepaths,
  createUploadRequest,
} from './file-upload'
import {
  createDeleteRequest,
  createGetRequest,
  createRequestWithJson,
  getErrorResponseBody,
  getHttpModule,
  getResponse,
  getResponseJson,
  isResponseOk,
  ResponseError,
  reshapeArtifactForPublicPolicy,
} from './http-client'
import {
  normalizeBaseUrl,
  promiseWithResolvers,
  queryToSearchParams,
  resolveAbsPaths,
  resolveBasePath,
} from './utils'

import type {
  Agent,
  ArtifactPatches,
  BatchPackageFetchResultType,
  BatchPackageStreamOptions,
  CompactSocketArtifact,
  CreateDependenciesSnapshotOptions,
  CustomResponseType,
  Entitlement,
  EntitlementsResponse,
  FileValidationCallback,
  GetOptions,
  GotOptions,
  PatchViewResponse,
  QueryParams,
  RequestOptions,
  SendOptions,
  SocketArtifact,
  SocketSdkErrorResult,
  SocketSdkGenericResult,
  SocketSdkOperations,
  SocketSdkOptions,
  SocketSdkResult,
  SocketSdkSuccessResult,
  StreamOrgFullScanOptions,
  UploadManifestFilesError,
  UploadManifestFilesOptions,
  UploadManifestFilesReturnType,
} from './types'
import type {
  CreateFullScanOptions,
  DeleteRepositoryLabelResult,
  DeleteResult,
  FullScanItem,
  FullScanListResult,
  FullScanResult,
  ListFullScansOptions,
  ListRepositoriesOptions,
  OrganizationsResult,
  RepositoriesListResult,
  RepositoryItem,
  RepositoryLabelItem,
  RepositoryLabelResult,
  RepositoryLabelsListResult,
  RepositoryResult,
  StrictErrorResult,
} from './types-strict'
import type { TtlCache } from '@socketsecurity/lib/cache-with-ttl'
import type { IncomingMessage } from 'node:http'

/**
 * Socket SDK for programmatic access to Socket.dev security analysis APIs.
 * Provides methods for package scanning, organization management, and security analysis.
 */
export class SocketSdk {
  readonly #apiToken: string
  readonly #baseUrl: string
  readonly #cache: TtlCache | undefined
  readonly #onFileValidation: FileValidationCallback | undefined
  readonly #reqOptions: RequestOptions
  readonly #retries: number
  readonly #retryDelay: number

  /**
   * Initialize Socket SDK with API token and configuration options.
   * Sets up authentication, base URL, HTTP client options, retry behavior, and caching.
   */
  constructor(apiToken: string, options?: SocketSdkOptions | undefined) {
    // Input validation for API token.
    const MAX_API_TOKEN_LENGTH = 1024
    if (typeof apiToken !== 'string') {
      throw new TypeError('"apiToken" is required and must be a string')
    }
    const trimmedToken = apiToken.trim()
    if (!trimmedToken) {
      throw new Error('"apiToken" cannot be empty or whitespace-only')
    }
    if (trimmedToken.length > MAX_API_TOKEN_LENGTH) {
      throw new Error(
        `"apiToken" exceeds maximum length of ${MAX_API_TOKEN_LENGTH} characters`,
      )
    }

    const {
      agent: agentOrObj,
      baseUrl = 'https://api.socket.dev/v0/',
      cache = false,
      cacheTtl = 5 * 60 * 1000,
      onFileValidation,
      retries = DEFAULT_RETRIES,
      retryDelay = DEFAULT_RETRY_DELAY,
      timeout = DEFAULT_HTTP_TIMEOUT,
      userAgent,
    } = { __proto__: null, ...options } as SocketSdkOptions

    // Validate timeout parameter.
    if (timeout !== undefined) {
      if (
        typeof timeout !== 'number' ||
        timeout < MIN_HTTP_TIMEOUT ||
        timeout > MAX_HTTP_TIMEOUT
      ) {
        throw new TypeError(
          `"timeout" must be a number between ${MIN_HTTP_TIMEOUT} and ${MAX_HTTP_TIMEOUT} milliseconds`,
        )
      }
    }

    const agentKeys = agentOrObj ? Object.keys(agentOrObj) : []
    const agentAsGotOptions = agentOrObj as GotOptions
    const agent = (
      agentKeys.length && agentKeys.every(k => httpAgentNames.has(k))
        ? /* c8 ignore next 3 - Got-style agent options compatibility layer */
          agentAsGotOptions.https ||
          agentAsGotOptions.http ||
          agentAsGotOptions.http2
        : agentOrObj
    ) as Agent | undefined
    this.#apiToken = trimmedToken
    this.#baseUrl = normalizeBaseUrl(baseUrl)
    this.#cache = cache
      ? createTtlCache({
          memoize: true,
          prefix: 'socket-sdk',
          ttl: cacheTtl,
        })
      : /* c8 ignore next - cache disabled by default */ undefined
    this.#onFileValidation = onFileValidation
    this.#retries = retries
    this.#retryDelay = retryDelay
    this.#reqOptions = {
      ...(agent ? { agent } : {}),
      headers: {
        Authorization: `Basic ${btoa(`${trimmedToken}:`)}`,
        'User-Agent': userAgent ?? DEFAULT_USER_AGENT,
      },
      signal: abortSignal,
      /* c8 ignore next - Optional timeout parameter, tested implicitly through method calls */
      ...(timeout ? { timeout } : {}),
    }
  }

  /**
   * Parse Retry-After header value and return delay in milliseconds.
   * Supports both delay-seconds (integer) and HTTP-date formats.
   */
  #parseRetryAfter(
    retryAfterValue: string | string[] | undefined,
  ): number | undefined {
    if (!retryAfterValue) {
      return undefined
    }

    // Handle array of values (take first).
    const value = Array.isArray(retryAfterValue)
      ? retryAfterValue[0]
      : retryAfterValue

    // Return if value is empty after extracting from array.
    if (!value) {
      return undefined
    }

    // Try parsing as seconds (integer).
    const seconds = Number.parseInt(value, 10)
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return seconds * 1000
    }

    // Try parsing as HTTP date.
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      const delayMs = date.getTime() - Date.now()
      // Only use if date is in the future.
      if (delayMs > 0) {
        return delayMs
      }
    }

    return undefined
  }

  /**
   * Execute an HTTP request with retry logic.
   * Internal method for wrapping HTTP operations with exponential backoff.
   */
  async #executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    const result = await pRetry(operation, {
      baseDelayMs: this.#retryDelay,
      onRetry: (
        _attempt: number,
        error: unknown,
        _delay: number,
      ): boolean | number | undefined => {
        /* c8 ignore next 3 - Early return for non-ResponseError types in retry logic */
        if (!(error instanceof ResponseError)) {
          return undefined
        }
        const { statusCode } = error.response
        // Don't retry authentication/authorization errors - they won't succeed.
        if (statusCode === 401 || statusCode === 403) {
          throw error
        }
        // Rate limiting (429) will be retried with custom delay if Retry-After header is present.
        if (statusCode === 429) {
          const retryAfter = this.#parseRetryAfter(
            error.response.headers['retry-after'],
          )
          if (retryAfter !== undefined) {
            // Return custom delay in milliseconds.
            // Note: Requires @socketsecurity/lib >= 1.0.5 with updated pRetry types.
            return retryAfter
          }
        }
        return undefined
      },
      onRetryRethrow: true,
      retries: this.#retries,
    })
    /* c8 ignore next 3 - Defensive check for undefined result from pRetry abort */
    if (result === undefined) {
      throw new Error('Request aborted')
    }
    return result
  }

  /**
   * Execute a GET request with optional caching.
   * Internal method for handling cached GET requests with retry logic.
   */
  async #getCached<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
    // If caching is disabled, just execute the request.
    if (!this.#cache) {
      return await this.#executeWithRetry(fetcher)
    }

    // Use cache with retry logic.
    return await this.#cache.getOrFetch(cacheKey, async () => {
      return await this.#executeWithRetry(fetcher)
    })
  }

  /**
   * Create async generator for streaming batch package URL processing.
   * Internal method for handling chunked PURL responses with error handling.
   */
  async *#createBatchPurlGenerator(
    componentsObj: { components: Array<{ purl: string }> },
    queryParams?: QueryParams | undefined,
  ): AsyncGenerator<BatchPackageFetchResultType> {
    let res: IncomingMessage | undefined
    try {
      res = await this.#executeWithRetry(() =>
        this.#createBatchPurlRequest(componentsObj, queryParams),
      )
      /* c8 ignore start - Error handling for network failures, difficult to test reliably */
    } catch (e) {
      yield await this.#handleApiError<'batchPackageFetch'>(e)
      return
    }
    /* c8 ignore stop */
    // Validate response before processing.
    /* c8 ignore next 3 - Defensive check, response should always be defined after successful request */
    if (!res) {
      throw new Error('Failed to get response from batch PURL request')
    }
    // Parse the newline delimited JSON response.
    const rli = readline.createInterface({
      input: res,
      crlfDelay: Number.POSITIVE_INFINITY,
      signal: abortSignal,
    })
    const isPublicToken = this.#apiToken === SOCKET_PUBLIC_API_TOKEN
    for await (const line of rli) {
      const trimmed = line.trim()
      const artifact = trimmed
        ? (jsonParse(line, { throws: false }) as SocketArtifact)
        : /* c8 ignore next - Empty line handling in batch streaming response parsing. */ null
      if (isObjectObject(artifact)) {
        yield this.#handleApiSuccess<'batchPackageFetch'>(
          /* c8 ignore next 7 - Public token artifact reshaping branch for policy compliance. */
          isPublicToken
            ? reshapeArtifactForPublicPolicy(
                artifact!,
                false,
                queryParams?.['actions'] as string,
              )
            : artifact!,
        )
      }
    }
  }

  /**
   * Create HTTP request for batch package URL processing.
   * Internal method for handling PURL batch API calls with retry logic.
   */
  async #createBatchPurlRequest(
    componentsObj: { components: Array<{ purl: string }> },
    queryParams?: QueryParams | undefined,
  ): Promise<IncomingMessage> {
    // Adds the first 'abort' listener to abortSignal.
    const req = getHttpModule(this.#baseUrl)
      .request(`${this.#baseUrl}purl?${queryToSearchParams(queryParams)}`, {
        method: 'POST',
        ...this.#reqOptions,
      })
      .end(JSON.stringify(componentsObj))
    const response = await getResponse(req)

    // Throw ResponseError for non-2xx status codes so retry logic works properly.
    /* c8 ignore next 3 - Error response handling for batch requests, requires API to return errors */
    if (!isResponseOk(response)) {
      throw new ResponseError(response)
    }

    return response
  }

  /**
   * Create standardized error result from query operation exceptions.
   * Internal error handling for non-throwing query API methods.
   */
  #createQueryErrorResult<T>(e: unknown): SocketSdkGenericResult<T> {
    if (e instanceof SyntaxError) {
      // Try to get response text from enhanced error, fall back to regex pattern for compatibility.
      const enhancedError = e as SyntaxError & {
        originalResponse?: string | undefined
      }
      /* c8 ignore next - Defensive empty string fallback for originalResponse. */
      let responseText = enhancedError.originalResponse || ''

      /* c8 ignore next 5 - Empty response text fallback check for JSON parsing errors without originalResponse. */
      if (!responseText) {
        const match = e.message.match(/Invalid JSON response:\n([\s\S]*?)\n→/)
        responseText = match?.[1] || ''
      }

      /* c8 ignore next - Defensive empty string fallback when slice returns empty. */
      const preview = responseText.slice(0, 100) || ''
      return {
        cause: `Please report this. JSON.parse threw an error over the following response: \`${preview.trim()}${responseText.length > 100 ? '…' : ''}\``,
        data: undefined,
        error: 'Server returned invalid JSON',
        status: 0,
        success: false,
      }
    }

    /* c8 ignore start - Defensive error stringification fallback branches for edge cases. */
    const errStr = e ? String(e).trim() : ''
    return {
      cause: errStr || UNKNOWN_ERROR,
      data: undefined,
      error: 'API request failed',
      status: 0,
      success: false,
    }
    /* c8 ignore stop */
  }

  /**
   * Extract text content from HTTP response stream.
   * Internal method with size limits to prevent memory exhaustion.
   */
  /* c8 ignore start - unused utility method reserved for future text response handling */
  async #getResponseText(response: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    let size = 0
    // 50MB limit to prevent out-of-memory errors from large responses.
    const MAX = 50 * 1024 * 1024
    for await (const chunk of response) {
      size += chunk.length
      if (size > MAX) {
        throw new Error('Response body exceeds maximum size limit')
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  /* c8 ignore stop */

  /**
   * Handle API error responses and convert to standardized error result.
   * Internal error handling with status code analysis and message formatting.
   */
  async #handleApiError<T extends SocketSdkOperations>(
    error: unknown,
  ): Promise<SocketSdkErrorResult<T>> {
    if (!(error instanceof ResponseError)) {
      throw new Error('Unexpected Socket API error', {
        cause: error,
      })
    }
    const { statusCode } = error.response
    // Throw server errors (5xx) immediately - these are not recoverable client-side.
    if (statusCode && statusCode >= 500) {
      throw new Error(`Socket API server error (${statusCode})`, {
        cause: error,
      })
    }
    // The error payload may give a meaningful hint as to what went wrong.
    const bodyStr = await getErrorResponseBody(error.response)
    // Try to parse the body as JSON, fallback to treating as plain text.
    let body: string | undefined
    try {
      const parsed: {
        error?:
          | { message?: string | undefined; details?: unknown | undefined }
          | undefined
      } = JSON.parse(bodyStr)
      // Client errors (4xx) should return actionable error messages.
      // Extract both message and details from error response for better context.
      /* c8 ignore next 8 - Error detail handling for API responses with detailed error messages */
      if (typeof parsed?.error?.message === 'string') {
        body = parsed.error.message

        // Include details if present for additional error context.
        if (parsed.error.details) {
          const detailsStr: string =
            typeof parsed.error.details === 'string'
              ? parsed.error.details
              : JSON.stringify(parsed.error.details)
          body = `${body} - Details: ${detailsStr}`
        }
      }
      /* c8 ignore start - JSON parse error fallback for malformed API responses */
    } catch {
      body = bodyStr
    }
    /* c8 ignore stop */
    // Build error message that includes the body content if available.
    /* c8 ignore next - Fallback error message when error.message is undefined */
    let errorMessage =
      error.message ??
      /* c8 ignore next - fallback for missing error message */ UNKNOWN_ERROR
    const trimmedBody = body?.trim()
    if (trimmedBody && !errorMessage.includes(trimmedBody)) {
      // Replace generic status message with actual error body if present,
      // otherwise append the body to the error message.
      const statusMessage = error.response?.statusMessage
      if (statusMessage && errorMessage.includes(statusMessage)) {
        errorMessage = errorMessage.replace(statusMessage, trimmedBody)
      } /* c8 ignore next 3 - edge case where statusMessage is undefined or not in error message. */ else {
        errorMessage = `${errorMessage}: ${trimmedBody}`
      }
    }

    // Add actionable guidance based on status code.
    let actionableGuidance: string | undefined
    if (statusCode === 401) {
      actionableGuidance = [
        '→ Authentication failed. API token is invalid or expired.',
        '→ Check: Your API token is correct and active.',
        `→ Generate a new token at: ${SOCKET_API_TOKENS_URL}`,
      ].join('\n')
    } else if (statusCode === 403) {
      actionableGuidance = [
        '→ Authorization failed. Insufficient permissions.',
        '→ Check: Your API token has required permissions for this operation.',
        '→ Check: You have access to the specified organization/repository.',
        `→ Verify: Organization settings at ${SOCKET_DASHBOARD_URL}`,
      ].join('\n')
    } else if (statusCode === 404) {
      actionableGuidance = [
        '→ Resource not found.',
        '→ Verify: Package name, version, or resource ID is correct.',
        '→ Check: Organization or repository exists and is accessible.',
      ].join('\n')
    } else if (statusCode === 429) {
      const retryAfter = error.response.headers['retry-after']
      const retryMsg = retryAfter
        ? `Retry after ${retryAfter} seconds.`
        : 'Wait before retrying.'
      actionableGuidance = [
        '→ Rate limit exceeded. Too many requests.',
        `→ ${retryMsg}`,
        '→ Try: Implement exponential backoff or enable SDK retry option.',
        `→ Contact support to increase rate limits: ${SOCKET_CONTACT_URL}`,
      ].join('\n')
    } else if (statusCode === 400) {
      actionableGuidance = [
        '→ Bad request. Invalid parameters or request body.',
        '→ Check: All required parameters are provided and correctly formatted.',
        '→ Verify: Package URLs (PURLs) follow correct format.',
      ].join('\n')
    } else if (statusCode === 413) {
      actionableGuidance = [
        '→ Payload too large. Request exceeds size limits.',
        '→ Try: Reduce the number of files or packages in a single request.',
        '→ Try: Use batch operations with smaller chunks.',
      ].join('\n')
    }

    // Append actionable guidance to cause if available.
    const causeWithGuidance = actionableGuidance
      ? [trimmedBody, '', actionableGuidance].filter(Boolean).join('\n')
      : body

    return {
      cause: causeWithGuidance,
      data: undefined,
      error: errorMessage,
      /* c8 ignore next - fallback for missing status code in edge cases. */
      status: statusCode ?? 0,
      success: false,
    } as SocketSdkErrorResult<T>
  }

  /**
   * Handle successful API responses and convert to standardized success result.
   * Internal success handling with consistent response formatting.
   */
  #handleApiSuccess<T extends SocketSdkOperations>(
    data: unknown,
  ): SocketSdkSuccessResult<T> {
    return {
      cause: undefined,
      data: data as SocketSdkSuccessResult<T>['data'],
      error: undefined,
      // Use generic 200 OK status for all successful API responses.
      status: 200,
      success: true,
    } satisfies SocketSdkSuccessResult<T>
  }

  /**
   * Handle query API response data based on requested response type.
   * Internal method for processing different response formats (json, text, response).
   */
  async #handleQueryResponseData<T>(
    response: IncomingMessage,
    responseType: CustomResponseType,
  ): Promise<T> {
    if (responseType === 'response') {
      return response as T
    }

    if (responseType === 'text') {
      return (await this.#getResponseText(response)) as T
    }

    if (responseType === 'json') {
      return (await getResponseJson(response)) as T
    }

    return response as T
  }

  /**
   * Fetch package analysis data for multiple packages in a single batch request.
   * Returns all results at once after processing is complete.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async batchPackageFetch(
    componentsObj: { components: Array<{ purl: string }> },
    queryParams?: QueryParams | undefined,
  ): Promise<BatchPackageFetchResultType> {
    let res: IncomingMessage | undefined
    try {
      res = await this.#createBatchPurlRequest(componentsObj, queryParams)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'batchPackageFetch'>(e)
    }
    /* c8 ignore stop */
    // Validate response before processing.
    /* c8 ignore next 3 - Defensive check, response should always be defined after successful request */
    if (!res) {
      throw new Error('Failed to get response from batch PURL request')
    }
    // Parse the newline delimited JSON response.
    const rli = readline.createInterface({
      input: res,
      crlfDelay: Number.POSITIVE_INFINITY,
      signal: abortSignal,
    })
    const isPublicToken = this.#apiToken === SOCKET_PUBLIC_API_TOKEN
    const results: SocketArtifact[] = []
    for await (const line of rli) {
      const trimmed = line.trim()
      const artifact = trimmed
        ? (jsonParse(line, { throws: false }) as SocketArtifact)
        : /* c8 ignore next - Empty line handling in batch parsing. */ null
      if (isObjectObject(artifact)) {
        results.push(
          /* c8 ignore next 7 - Public token artifact reshaping for policy compliance. */
          isPublicToken
            ? reshapeArtifactForPublicPolicy(
                artifact!,
                false,
                queryParams?.['actions'] as string,
              )
            : artifact!,
        )
      }
    }
    const compact = urlSearchParamAsBoolean(
      getOwn(queryParams, 'compact') as string | null | undefined,
    )
    return this.#handleApiSuccess<'batchPackageFetch'>(
      compact ? (results as CompactSocketArtifact[]) : results,
    )
  }

  /**
   * Stream package analysis data for multiple packages with chunked processing and concurrency control.
   * Returns results as they become available via async generator.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async *batchPackageStream(
    componentsObj: { components: Array<{ purl: string }> },
    options?: BatchPackageStreamOptions | undefined,
  ): AsyncGenerator<BatchPackageFetchResultType> {
    const {
      chunkSize = 100,
      concurrencyLimit = 10,
      queryParams,
    } = {
      __proto__: null,
      ...options,
    } as BatchPackageStreamOptions

    type GeneratorStep = {
      generator: AsyncGenerator<BatchPackageFetchResultType>
      iteratorResult: IteratorResult<BatchPackageFetchResultType>
    }
    type GeneratorEntry = {
      generator: AsyncGenerator<BatchPackageFetchResultType>
      promise: Promise<GeneratorStep>
    }

    // The createBatchPurlGenerator method will add 2 'abort' event listeners to
    // abortSignal so we multiply the concurrencyLimit by 2.
    const neededMaxListeners = concurrencyLimit * 2
    // Increase abortSignal max listeners count to avoid Node's MaxListenersExceededWarning.
    /* c8 ignore start - EventTarget max listeners adjustment for high concurrency batch operations, difficult to test reliably. */
    setMaxEventTargetListeners(abortSignal, neededMaxListeners)
    /* c8 ignore stop */
    const { components } = componentsObj
    const { length: componentsCount } = components
    const running: GeneratorEntry[] = []
    let index = 0
    const enqueueGen = () => {
      if (index >= componentsCount) {
        // No more work to do.
        return
      }
      const generator = this.#createBatchPurlGenerator(
        {
          // Chunk components.
          components: components.slice(index, index + chunkSize),
        },
        queryParams,
      )
      continueGen(generator)
      index += chunkSize
    }
    const continueGen = (
      generator: AsyncGenerator<BatchPackageFetchResultType>,
    ) => {
      const {
        promise,
        reject: rejectFn,
        resolve: resolveFn,
      } = promiseWithResolvers<GeneratorStep>()
      running.push({
        generator,
        promise,
      })
      void generator
        .next()
        .then(
          iteratorResult => resolveFn({ generator, iteratorResult }),
          rejectFn,
        )
    }
    // Start initial batch of generators.
    while (running.length < concurrencyLimit && index < componentsCount) {
      enqueueGen()
    }
    while (running.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      const { generator, iteratorResult }: GeneratorStep = await Promise.race(
        running.map(entry => entry.promise),
      )
      // Remove generator with safe index lookup.
      const index = running.findIndex(entry => entry.generator === generator)
      /* c8 ignore next 3 - Defensive check for concurrent generator cleanup edge case. */
      if (index === -1) {
        continue
      }
      running.splice(index, 1)
      // Yield the value if one is given, even when done:true.
      if (iteratorResult.value) {
        yield iteratorResult.value
      }
      if (iteratorResult.done) {
        // Start a new generator if available.
        enqueueGen()
      } else {
        // Keep fetching values from this generator.
        continueGen(generator)
      }
    }
  }

  /**
   * Create a snapshot of project dependencies by uploading manifest files.
   * Analyzes dependency files to generate a comprehensive security report.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async createDependenciesSnapshot(
    filepaths: string[],
    options?: CreateDependenciesSnapshotOptions | undefined,
  ): Promise<SocketSdkResult<'createDependenciesSnapshot'>> {
    const { pathsRelativeTo = '.', queryParams } = {
      __proto__: null,
      ...options,
    } as CreateDependenciesSnapshotOptions
    const basePath = resolveBasePath(pathsRelativeTo)
    const absFilepaths = resolveAbsPaths(filepaths, basePath)

    // Validate file readability before upload.
    const { invalidPaths, validPaths } = validateFiles(absFilepaths)

    // If callback provided and files were invalid, invoke it.
    if (this.#onFileValidation && invalidPaths.length > 0) {
      const result = await this.#onFileValidation(validPaths, invalidPaths, {
        operation: 'createDependenciesSnapshot',
      })

      if (!result.shouldContinue) {
        return {
          cause: result.errorCause,
          data: undefined,
          error: result.errorMessage ?? 'File validation failed',
          status: 400,
          success: false,
        } as SocketSdkErrorResult<'createDependenciesSnapshot'>
      }
    }

    // Default behavior if no callback: warn and continue.
    if (!this.#onFileValidation && invalidPaths.length > 0) {
      const samplePaths = invalidPaths.slice(0, 3).join('\n  - ')
      const remaining =
        invalidPaths.length > 3
          ? `\n  ... and ${invalidPaths.length - 3} more`
          : ''
      console.warn(
        `Warning: ${invalidPaths.length} files skipped (unreadable):\n  - ${samplePaths}${remaining}\n` +
          '→ This may occur with Yarn Berry PnP or pnpm symlinks.\n' +
          '→ Try: Run installation command to ensure files are accessible.',
      )
    }

    // Fail if all files were invalid.
    if (validPaths.length === 0) {
      const samplePaths = invalidPaths.slice(0, 5).join('\n  - ')
      const remaining =
        invalidPaths.length > 5
          ? `\n  ... and ${invalidPaths.length - 5} more`
          : ''
      return {
        cause: [
          `All ${invalidPaths.length} files failed validation:`,
          `  - ${samplePaths}${remaining}`,
          '',
          '→ Common causes:',
          '  ·Yarn Berry PnP virtual filesystem (files are not on disk)',
          '  ·pnpm symlinks pointing to inaccessible locations',
          '  ·Incorrect file permissions',
          '  ·Files were deleted after discovery',
          '',
          '→ Solutions:',
          '  ·Yarn Berry: Use `nodeLinker: node-modules` in .yarnrc.yml',
          '  ·pnpm: Use `node-linker=hoisted` in .npmrc',
          '  ·Check file permissions with: ls -la <file>',
          '  ·Run package manager install command',
        ].join('\n'),
        data: undefined,
        error: 'No readable manifest files found',
        status: 400,
        success: false,
      } as SocketSdkErrorResult<'createDependenciesSnapshot'>
    }

    // Continue with validated files.
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createUploadRequest(
              this.#baseUrl,
              `dependencies/upload?${queryToSearchParams(queryParams)}`,
              createRequestBodyForFilepaths(validPaths, basePath),
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'createDependenciesSnapshot'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'createDependenciesSnapshot'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Create a diff scan from two full scan IDs.
   * Compares two existing full scans to identify changes.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async createOrgDiffScanFromIds(
    orgSlug: string,
    queryParams?: QueryParams | undefined,
  ): Promise<SocketSdkResult<'createOrgDiffScanFromIds'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/diff-scans?${queryToSearchParams(queryParams)}`,
              {},
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'createOrgDiffScanFromIds'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'createOrgDiffScanFromIds'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Create a full security scan for an organization.
   *
   * Uploads project manifest files and initiates full security analysis.
   * Returns scan metadata with guaranteed required fields.
   *
   * @param orgSlug - Organization identifier
   * @param filepaths - Array of file paths to upload (package.json, package-lock.json, etc.)
   * @param options - Scan configuration including repository, branch, and commit details
   * @returns Full scan metadata including ID and URLs
   *
   * @example
   * ```typescript
   * const result = await sdk.createFullScan('my-org',
   *   ['package.json', 'package-lock.json'],
   *   {
   *     repo: 'my-repo',
   *     branch: 'main',
   *     commit_message: 'Update dependencies',
   *     commit_hash: 'abc123',
   *     pathsRelativeTo: './my-project'
   *   }
   * )
   *
   * if (result.success) {
   *   console.log('Scan ID:', result.data.id)
   *   console.log('Report URL:', result.data.html_report_url)
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/createorgfullscan
   * @apiEndpoint POST /orgs/{org_slug}/full-scans
   * @quota 1 unit
   * @scopes full-scans:create
   * @throws {Error} When server returns 5xx status codes
   */
  async createFullScan(
    orgSlug: string,
    filepaths: string[],
    options: CreateFullScanOptions,
  ): Promise<FullScanResult | StrictErrorResult> {
    const { pathsRelativeTo = '.', ...queryParams } = {
      __proto__: null,
      ...options,
    } as CreateFullScanOptions
    const basePath = resolveBasePath(pathsRelativeTo)
    const absFilepaths = resolveAbsPaths(filepaths, basePath)

    // Validate file readability before upload.
    const { invalidPaths, validPaths } = validateFiles(absFilepaths)

    // If callback provided and files were invalid, invoke it.
    if (this.#onFileValidation && invalidPaths.length > 0) {
      const result = await this.#onFileValidation(validPaths, invalidPaths, {
        operation: 'createFullScan',
        orgSlug,
      })

      if (!result.shouldContinue) {
        return {
          cause: result.errorCause,
          data: undefined,
          error: result.errorMessage ?? 'File validation failed',
          status: 400,
          success: false,
        } as StrictErrorResult
      }
    }

    // Default behavior if no callback: warn and continue.
    if (!this.#onFileValidation && invalidPaths.length > 0) {
      const samplePaths = invalidPaths.slice(0, 3).join('\n  - ')
      const remaining =
        invalidPaths.length > 3
          ? `\n  ... and ${invalidPaths.length - 3} more`
          : ''
      console.warn(
        `Warning: ${invalidPaths.length} files skipped (unreadable):\n  - ${samplePaths}${remaining}\n` +
          '→ This may occur with Yarn Berry PnP or pnpm symlinks.\n' +
          '→ Try: Run installation command to ensure files are accessible.',
      )
    }

    // Fail if all files were invalid.
    if (validPaths.length === 0) {
      const samplePaths = invalidPaths.slice(0, 5).join('\n  - ')
      const remaining =
        invalidPaths.length > 5
          ? `\n  ... and ${invalidPaths.length - 5} more`
          : ''
      return {
        cause: [
          `All ${invalidPaths.length} files failed validation:`,
          `  - ${samplePaths}${remaining}`,
          '',
          '→ Common causes:',
          '  ·Yarn Berry PnP virtual filesystem (files are not on disk)',
          '  ·pnpm symlinks pointing to inaccessible locations',
          '  ·Incorrect file permissions',
          '  ·Files were deleted after discovery',
          '',
          '→ Solutions:',
          '  ·Yarn Berry: Use `nodeLinker: node-modules` in .yarnrc.yml',
          '  ·pnpm: Use `node-linker=hoisted` in .npmrc',
          '  ·Check file permissions with: ls -la <file>',
          '  ·Run package manager install command',
        ].join('\n'),
        data: undefined,
        error: 'No readable manifest files found',
        status: 400,
        success: false,
      } as StrictErrorResult
    }

    // Continue with validated files.
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createUploadRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/full-scans?${queryToSearchParams(queryParams as QueryParams)}`,
              createRequestBodyForFilepaths(validPaths, basePath),
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as FullScanItem,
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'CreateOrgFullScan'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Create a new repository in an organization.
   *
   * Registers a repository for monitoring and security scanning.
   *
   * @param orgSlug - Organization identifier
   * @param params - Repository configuration (name, description, homepage, etc.)
   * @returns Created repository details
   *
   * @example
   * ```typescript
   * const result = await sdk.createRepository('my-org', {
   *   name: 'my-repo',
   *   description: 'My project repository',
   *   homepage: 'https://example.com'
   * })
   *
   * if (result.success) {
   *   console.log('Repository created:', result.data.id)
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/createorgrepo
   * @apiEndpoint POST /orgs/{org_slug}/repos
   * @quota 1 unit
   * @scopes repo:write
   * @throws {Error} When server returns 5xx status codes
   */
  async createRepository(
    orgSlug: string,
    params?: QueryParams | undefined,
  ): Promise<RepositoryResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/repos`,
              params,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as RepositoryItem,
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'createOrgRepo'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Create a new repository label for an organization.
   *
   * Labels can be used to group and organize repositories and apply security/license policies.
   *
   * @param orgSlug - Organization identifier
   * @param labelData - Label configuration (must include name property)
   * @returns Created label with guaranteed id and name fields
   *
   * @example
   * ```typescript
   * const result = await sdk.createRepositoryLabel('my-org', { name: 'production' })
   *
   * if (result.success) {
   *   console.log('Label created:', result.data.id)
   *   console.log('Label name:', result.data.name)
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/createorgrepolabel
   * @apiEndpoint POST /orgs/{org_slug}/repos/labels
   * @quota 1 unit
   * @scopes repo-label:create
   * @throws {Error} When server returns 5xx status codes
   */
  async createRepositoryLabel(
    orgSlug: string,
    labelData: QueryParams,
  ): Promise<RepositoryLabelResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/repos/labels`,
              labelData,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as RepositoryLabelItem,
        error: undefined,
        status: 201,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'createOrgRepoLabel'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Delete a diff scan from an organization.
   * Permanently removes diff scan data and results.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async deleteOrgDiffScan(
    orgSlug: string,
    diffScanId: string,
  ): Promise<SocketSdkResult<'deleteOrgDiffScan'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createDeleteRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/diff-scans/${encodeURIComponent(diffScanId)}`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'deleteOrgDiffScan'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'deleteOrgDiffScan'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Delete a full scan from an organization.
   *
   * Permanently removes scan data and results.
   *
   * @param orgSlug - Organization identifier
   * @param scanId - Full scan identifier to delete
   * @returns Success confirmation
   *
   * @example
   * ```typescript
   * const result = await sdk.deleteFullScan('my-org', 'scan_123')
   *
   * if (result.success) {
   *   console.log('Scan deleted successfully')
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/deleteorgfullscan
   * @apiEndpoint DELETE /orgs/{org_slug}/full-scans/{full_scan_id}
   * @quota 1 unit
   * @scopes full-scans:delete
   * @throws {Error} When server returns 5xx status codes
   */
  async deleteFullScan(
    orgSlug: string,
    scanId: string,
  ): Promise<DeleteResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createDeleteRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/full-scans/${encodeURIComponent(scanId)}`,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as DeleteResult['data'],
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'deleteOrgFullScan'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Delete a repository from an organization.
   *
   * Removes repository monitoring and associated scan data.
   *
   * @param orgSlug - Organization identifier
   * @param repoSlug - Repository slug/name to delete
   * @returns Success confirmation
   *
   * @example
   * ```typescript
   * const result = await sdk.deleteRepository('my-org', 'old-repo')
   *
   * if (result.success) {
   *   console.log('Repository deleted')
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/deleteorgrepo
   * @apiEndpoint DELETE /orgs/{org_slug}/repos/{repo_slug}
   * @quota 1 unit
   * @scopes repo:write
   * @throws {Error} When server returns 5xx status codes
   */
  async deleteRepository(
    orgSlug: string,
    repoSlug: string,
  ): Promise<DeleteResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createDeleteRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/repos/${encodeURIComponent(repoSlug)}`,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as DeleteResult['data'],
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'deleteOrgRepo'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Delete a repository label from an organization.
   *
   * Removes label and all its associations (repositories, security policy, license policy, etc.).
   *
   * @param orgSlug - Organization identifier
   * @param labelId - Label identifier
   * @returns Deletion confirmation
   *
   * @example
   * ```typescript
   * const result = await sdk.deleteRepositoryLabel('my-org', 'label-id-123')
   *
   * if (result.success) {
   *   console.log('Label deleted:', result.data.status)
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/deleteorgrepolabel
   * @apiEndpoint DELETE /orgs/{org_slug}/repos/labels/{label_id}
   * @quota 1 unit
   * @scopes repo-label:delete
   * @throws {Error} When server returns 5xx status codes
   */
  async deleteRepositoryLabel(
    orgSlug: string,
    labelId: string,
  ): Promise<DeleteRepositoryLabelResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createDeleteRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/repos/labels/${encodeURIComponent(labelId)}`,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as DeleteRepositoryLabelResult['data'],
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'deleteOrgRepoLabel'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Delete a legacy scan report permanently.
  /**
   * Export scan results in CycloneDX SBOM format.
   * Returns Software Bill of Materials compliant with CycloneDX standard.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async exportCDX(
    orgSlug: string,
    fullScanId: string,
  ): Promise<SocketSdkResult<'exportCDX'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/full-scans/${encodeURIComponent(fullScanId)}/sbom/export/cdx`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'exportCDX'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'exportCDX'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Export scan results in SPDX SBOM format.
   * Returns Software Bill of Materials compliant with SPDX standard.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async exportSPDX(
    orgSlug: string,
    fullScanId: string,
  ): Promise<SocketSdkResult<'exportSPDX'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/full-scans/${encodeURIComponent(fullScanId)}/sbom/export/spdx`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'exportSPDX'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'exportSPDX'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Execute a raw GET request to any API endpoint with configurable response type.
   * Supports both throwing (default) and non-throwing modes.
   * @param urlPath - API endpoint path (e.g., 'organizations')
   * @param options - Request options including responseType and throws behavior
   * @returns Raw response, parsed data, or SocketSdkGenericResult based on options
   */
  async getApi<T = IncomingMessage>(
    urlPath: string,
    options?: GetOptions | undefined,
  ): Promise<T | SocketSdkGenericResult<T>> {
    const { responseType = 'response', throws = true } = {
      __proto__: null,
      ...options,
    } as GetOptions

    try {
      const response = await createGetRequest(
        this.#baseUrl,
        urlPath,
        this.#reqOptions,
      )
      // Check for HTTP error status codes first.
      if (!isResponseOk(response)) {
        if (throws) {
          throw new ResponseError(response)
        }
        const errorResult = await this.#handleApiError<never>(
          new ResponseError(response),
        )
        return {
          cause: errorResult.cause,
          data: undefined,
          error: errorResult.error,
          status: errorResult.status,
          success: false,
        }
      }

      const data = await this.#handleQueryResponseData<T>(
        response,
        responseType,
      )

      if (throws) {
        return data as T
      }

      return {
        cause: undefined,
        data,
        error: undefined,
        /* c8 ignore next - Defensive fallback: response.statusCode is always defined in Node.js http/https */
        status: response.statusCode ?? 200,
        success: true,
      }
    } catch (e) {
      if (throws) {
        throw e
      }

      /* c8 ignore start - Defensive fallback: ResponseError in catch block handled in try block (lines 897-910) */
      if (e instanceof ResponseError) {
        // Re-use existing error handling logic from the SDK
        const errorResult = await this.#handleApiError<never>(e)
        return {
          cause: errorResult.cause,
          data: undefined,
          error: errorResult.error,
          status: errorResult.status,
          success: false,
        }
      }
      /* c8 ignore stop */

      /* c8 ignore next - Fallback error handling for non-ResponseError cases in getApi. */
      return this.#createQueryErrorResult<T>(e)
    }
  }

  /**
   * Get list of API tokens for an organization.
   * Returns organization API tokens with metadata and permissions.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getAPITokens(
    orgSlug: string,
  ): Promise<SocketSdkResult<'getAPITokens'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/tokens`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getAPITokens'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getAPITokens'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Retrieve audit log events for an organization.
   * Returns chronological log of security and administrative actions.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getAuditLogEvents(
    orgSlug: string,
    queryParams?: QueryParams | undefined,
  ): Promise<SocketSdkResult<'getAuditLogEvents'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/audit-log?${queryToSearchParams(queryParams)}`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getAuditLogEvents'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getAuditLogEvents'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Get details for a specific diff scan.
   * Returns comparison between two full scans with artifact changes.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getDiffScanById(
    orgSlug: string,
    diffScanId: string,
  ): Promise<SocketSdkResult<'getDiffScanById'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/diff-scans/${encodeURIComponent(diffScanId)}`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getDiffScanById'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getDiffScanById'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Retrieve the enabled entitlements for an organization.
   *
   * This method fetches the organization's entitlements and filters for only* the enabled ones, returning their keys. Entitlements represent Socket
   * Products that the organization has access to use.
   */
  async getEnabledEntitlements(orgSlug: string): Promise<string[]> {
    const data = await this.#executeWithRetry(
      async () =>
        await getResponseJson(
          await createGetRequest(
            this.#baseUrl,
            `orgs/${encodeURIComponent(orgSlug)}/entitlements`,
            this.#reqOptions,
          ),
        ),
    )

    // Extract enabled products from the response.
    const items = (data as EntitlementsResponse)?.items || []
    return items
      .filter((item: Entitlement) => item && item.enabled === true && item.key)
      .map((item: Entitlement) => item.key)
  }

  /**
   * Retrieve all entitlements for an organization.
   *
   * This method fetches all entitlements (both enabled and disabled) for
   * an organization, returning the complete list with their status.
   */
  async getEntitlements(orgSlug: string): Promise<Entitlement[]> {
    const data = await this.#executeWithRetry(
      async () =>
        await getResponseJson(
          await createGetRequest(
            this.#baseUrl,
            `orgs/${encodeURIComponent(orgSlug)}/entitlements`,
            this.#reqOptions,
          ),
        ),
    )

    return (data as EntitlementsResponse)?.items || []
  }

  /**
   * Get security issues for a specific npm package and version.
   * Returns detailed vulnerability and security alert information.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getIssuesByNpmPackage(
    pkgName: string,
    version: string,
  ): Promise<SocketSdkResult<'getIssuesByNPMPackage'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `npm/${encodeURIComponent(pkgName)}/${encodeURIComponent(version)}/issues`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getIssuesByNPMPackage'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getIssuesByNPMPackage'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Get analytics data for organization usage patterns and security metrics.
   * Returns statistical analysis for specified time period.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getOrgAnalytics(
    time: string,
  ): Promise<SocketSdkResult<'getOrgAnalytics'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `analytics/org/${encodeURIComponent(time)}`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getOrgAnalytics'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getOrgAnalytics'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * List all organizations accessible to the current user.
   *
   * Returns organization details and access permissions with guaranteed required fields.
   *
   * @returns List of organizations with metadata
   *
   * @example
   * ```typescript
   * const result = await sdk.listOrganizations()
   *
   * if (result.success) {
   *   result.data.organizations.forEach(org => {
   *     console.log(org.name, org.slug)  // Guaranteed fields
   *   })
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/getorganizations
   * @apiEndpoint GET /organizations
   * @quota 1 unit
   * @throws {Error} When server returns 5xx status codes
   */
  async listOrganizations(): Promise<OrganizationsResult | StrictErrorResult> {
    try {
      const data = await this.#getCached(
        'organizations',
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              'organizations',
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as OrganizationsResult['data'],
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'getOrganizations'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Get complete full scan results buffered in memory.
   *
   * Returns entire scan data as JSON for programmatic processing.
   * For large scans, consider using streamFullScan() instead.
   *
   * @param orgSlug - Organization identifier
   * @param scanId - Full scan identifier
   * @returns Complete full scan data including all artifacts
   *
   * @example
   * ```typescript
   * const result = await sdk.getFullScan('my-org', 'scan_123')
   *
   * if (result.success) {
   *   console.log('Scan status:', result.data.scan_state)
   *   console.log('Repository:', result.data.repository_slug)
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/getorgfullscan
   * @apiEndpoint GET /orgs/{org_slug}/full-scans/{full_scan_id}
   * @quota 1 unit
   * @scopes full-scans:list
   * @throws {Error} When server returns 5xx status codes
   */
  async getFullScan(
    orgSlug: string,
    scanId: string,
  ): Promise<FullScanResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/full-scans/${encodeURIComponent(scanId)}`,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as FullScanItem,
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'getOrgFullScan'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * List all full scans for an organization.
   *
   * Returns paginated list of full scan metadata with guaranteed required fields
   * for improved TypeScript autocomplete.
   *
   * @param orgSlug - Organization identifier
   * @param options - Filtering and pagination options
   * @returns List of full scans with metadata
   *
   * @example
   * ```typescript
   * const result = await sdk.listFullScans('my-org', {
   *   branch: 'main',
   *   per_page: 50,
   *   use_cursor: true
   * })
   *
   * if (result.success) {
   *   result.data.results.forEach(scan => {
   *     console.log(scan.id, scan.created_at)  // Guaranteed fields
   *   })
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/getorgfullscanlist
   * @apiEndpoint GET /orgs/{org_slug}/full-scans
   * @quota 1 unit
   * @scopes full-scans:list
   * @throws {Error} When server returns 5xx status codes
   */
  async listFullScans(
    orgSlug: string,
    options?: ListFullScansOptions | undefined,
  ): Promise<FullScanListResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/full-scans?${queryToSearchParams(options as QueryParams)}`,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as FullScanListResult['data'],
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'getOrgFullScanList'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Get metadata for a specific full scan.
   *
   * Returns scan configuration, status, and summary information without full artifact data.
   * Useful for checking scan status without downloading complete results.
   *
   * @param orgSlug - Organization identifier
   * @param scanId - Full scan identifier
   * @returns Scan metadata including status and configuration
   *
   * @example
   * ```typescript
   * const result = await sdk.getFullScanMetadata('my-org', 'scan_123')
   *
   * if (result.success) {
   *   console.log('Scan state:', result.data.scan_state)
   *   console.log('Branch:', result.data.branch)
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/getorgfullscanmetadata
   * @apiEndpoint GET /orgs/{org_slug}/full-scans/{full_scan_id}/metadata
   * @quota 1 unit
   * @scopes full-scans:list
   * @throws {Error} When server returns 5xx status codes
   */
  async getFullScanMetadata(
    orgSlug: string,
    scanId: string,
  ): Promise<FullScanResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/full-scans/${encodeURIComponent(scanId)}/metadata`,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as FullScanItem,
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult =
        await this.#handleApiError<'getOrgFullScanMetadata'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Get organization's license policy configuration.* Returns allowed, restricted, and monitored license types.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getOrgLicensePolicy(
    orgSlug: string,
  ): Promise<SocketSdkResult<'getOrgLicensePolicy'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/settings/license-policy`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getOrgLicensePolicy'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getOrgLicensePolicy'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Get details for a specific repository.
   *
   * Returns repository configuration, monitoring status, and metadata.
   *
   * @param orgSlug - Organization identifier
   * @param repoSlug - Repository slug/name
   * @returns Repository details with configuration
   *
   * @example
   * ```typescript
   * const result = await sdk.getRepository('my-org', 'my-repo')
   *
   * if (result.success) {
   *   console.log('Repository:', result.data.name)
   *   console.log('Visibility:', result.data.visibility)
   *   console.log('Default branch:', result.data.default_branch)
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/getorgrepo
   * @apiEndpoint GET /orgs/{org_slug}/repos/{repo_slug}
   * @quota 1 unit
   * @scopes repo:read
   * @throws {Error} When server returns 5xx status codes
   */
  async getRepository(
    orgSlug: string,
    repoSlug: string,
  ): Promise<RepositoryResult | StrictErrorResult> {
    const orgSlugParam = encodeURIComponent(orgSlug)
    const repoSlugParam = encodeURIComponent(repoSlug)

    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${orgSlugParam}/repos/${repoSlugParam}`,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as RepositoryItem,
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'getOrgRepo'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Get details for a specific repository label.
   *
   * Returns label configuration, associated repositories, and policy settings.
   *
   * @param orgSlug - Organization identifier
   * @param labelId - Label identifier
   * @returns Label details with guaranteed id and name fields
   *
   * @example
   * ```typescript
   * const result = await sdk.getRepositoryLabel('my-org', 'label-id-123')
   *
   * if (result.success) {
   *   console.log('Label name:', result.data.name)
   *   console.log('Associated repos:', result.data.repository_ids)
   *   console.log('Has security policy:', result.data.has_security_policy)
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/getorgrepolabel
   * @apiEndpoint GET /orgs/{org_slug}/repos/labels/{label_id}
   * @quota 1 unit
   * @scopes repo-label:list
   * @throws {Error} When server returns 5xx status codes
   */
  async getRepositoryLabel(
    orgSlug: string,
    labelId: string,
  ): Promise<RepositoryLabelResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/repos/labels/${encodeURIComponent(labelId)}`,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as RepositoryLabelItem,
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'getOrgRepoLabel'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * List all repository labels for an organization.
   *
   * Returns paginated list of labels configured for repository organization and policy management.
   *
   * @param orgSlug - Organization identifier
   * @param options - Pagination options
   * @returns List of labels with guaranteed id and name fields
   *
   * @example
   * ```typescript
   * const result = await sdk.listRepositoryLabels('my-org', { per_page: 50, page: 1 })
   *
   * if (result.success) {
   *   result.data.results.forEach(label => {
   *     console.log('Label:', label.name)
   *     console.log('Associated repos:', label.repository_ids?.length || 0)
   *   })
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/getorgrepolabellist
   * @apiEndpoint GET /orgs/{org_slug}/repos/labels
   * @quota 1 unit
   * @scopes repo-label:list
   * @throws {Error} When server returns 5xx status codes
   */
  async listRepositoryLabels(
    orgSlug: string,
    options?: QueryParams | undefined,
  ): Promise<RepositoryLabelsListResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/repos/labels?${queryToSearchParams(options as QueryParams)}`,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as RepositoryLabelsListResult['data'],
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'getOrgRepoLabelList'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * List all repositories in an organization.
   *
   * Returns paginated list of repository metadata with guaranteed required fields.
   *
   * @param orgSlug - Organization identifier
   * @param options - Pagination and filtering options
   * @returns List of repositories with metadata
   *
   * @example
   * ```typescript
   * const result = await sdk.listRepositories('my-org', {
   *   per_page: 50,
   *   sort: 'name',
   *   direction: 'asc'
   * })
   *
   * if (result.success) {
   *   result.data.results.forEach(repo => {
   *     console.log(repo.name, repo.visibility)
   *   })
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/getorgrepolist
   * @apiEndpoint GET /orgs/{org_slug}/repos
   * @quota 1 unit
   * @scopes repo:list
   * @throws {Error} When server returns 5xx status codes
   */
  async listRepositories(
    orgSlug: string,
    options?: ListRepositoriesOptions | undefined,
  ): Promise<RepositoriesListResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/repos?${queryToSearchParams(options as QueryParams)}`,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as RepositoriesListResult['data'],
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'getOrgRepoList'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Get organization's security policy configuration.* Returns alert rules, severity thresholds, and enforcement settings.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getOrgSecurityPolicy(
    orgSlug: string,
  ): Promise<SocketSdkResult<'getOrgSecurityPolicy'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/settings/security-policy`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getOrgSecurityPolicy'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getOrgSecurityPolicy'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Get organization triage settings and status.
   * Returns alert triage configuration and current state.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getOrgTriage(
    orgSlug: string,
  ): Promise<SocketSdkResult<'getOrgTriage'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/triage`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getOrgTriage'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getOrgTriage'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Get current API quota usage and limits.
   * Returns remaining requests, rate limits, and quota reset times.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getQuota(): Promise<SocketSdkResult<'getQuota'>> {
    try {
      const data = await this.#getCached(
        'quota',
        async () =>
          await getResponseJson(
            await createGetRequest(this.#baseUrl, 'quota', this.#reqOptions),
          ),
      )
      return this.#handleApiSuccess<'getQuota'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getQuota'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Get analytics data for a specific repository.
   * Returns security metrics, dependency trends, and vulnerability statistics.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getRepoAnalytics(
    repo: string,
    time: string,
  ): Promise<SocketSdkResult<'getRepoAnalytics'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `analytics/repo/${encodeURIComponent(repo)}/${encodeURIComponent(time)}`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getRepoAnalytics'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getRepoAnalytics'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Get detailed results for a legacy scan report.
  /**
  /**
   * Get security score for a specific npm package and version.
   * Returns numerical security rating and scoring breakdown.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getScoreByNpmPackage(
    pkgName: string,
    version: string,
  ): Promise<SocketSdkResult<'getScoreByNPMPackage'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `npm/${encodeURIComponent(pkgName)}/${encodeURIComponent(version)}/score`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getScoreByNPMPackage'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getScoreByNPMPackage'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Get list of file types and formats supported for scanning.
   * Returns supported manifest files, lockfiles, and configuration formats.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async getSupportedScanFiles(): Promise<
    SocketSdkResult<'getReportSupportedFiles'>
  > {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              'report/supported',
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'getReportSupportedFiles'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getReportSupportedFiles'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * List all diff scans for an organization.
   * Returns paginated list of diff scan metadata and status.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async listOrgDiffScans(
    orgSlug: string,
  ): Promise<SocketSdkResult<'listOrgDiffScans'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createGetRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/diff-scans`,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'listOrgDiffScans'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'listOrgDiffScans'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Create a new API token for an organization.
   * Generates API token with specified scopes and metadata.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async postAPIToken(
    orgSlug: string,
    tokenData: QueryParams,
  ): Promise<SocketSdkResult<'postAPIToken'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/tokens`,
              tokenData,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'postAPIToken'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'postAPIToken'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Revoke an API token for an organization.
   * Permanently disables the token and removes access.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async postAPITokensRevoke(
    orgSlug: string,
    tokenId: string,
  ): Promise<SocketSdkResult<'postAPITokensRevoke'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/tokens/${encodeURIComponent(tokenId)}/revoke`,
              {},
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'postAPITokensRevoke'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'postAPITokensRevoke'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Rotate an API token for an organization.
   * Generates new token value while preserving token metadata.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async postAPITokensRotate(
    orgSlug: string,
    tokenId: string,
  ): Promise<SocketSdkResult<'postAPITokensRotate'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/tokens/${encodeURIComponent(tokenId)}/rotate`,
              {},
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'postAPITokensRotate'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'postAPITokensRotate'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Update an existing API token for an organization.
   * Modifies token metadata, scopes, or other properties.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async postAPITokenUpdate(
    orgSlug: string,
    tokenId: string,
    updateData: QueryParams,
  ): Promise<SocketSdkResult<'postAPITokenUpdate'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/tokens/${encodeURIComponent(tokenId)}/update`,
              updateData,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'postAPITokenUpdate'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'postAPITokenUpdate'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Update user or organization settings.
   * Configures preferences, notifications, and security policies.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async postSettings(
    selectors: Array<{ organization?: string | undefined }>,
  ): Promise<SocketSdkResult<'postSettings'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              'settings',
              { json: selectors },
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'postSettings'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'postSettings'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Search for dependencies across monitored projects.
   * Returns matching packages with security information and usage patterns.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async searchDependencies(
    queryParams?: QueryParams | undefined,
  ): Promise<SocketSdkResult<'searchDependencies'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              'dependencies/search',
              queryParams,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'searchDependencies'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'searchDependencies'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Send POST or PUT request with JSON body and return parsed JSON response.
   * Supports both throwing (default) and non-throwing modes.
   * @param urlPath - API endpoint path (e.g., 'organizations')
   * @param options - Request options including method, body, and throws behavior
   * @returns Parsed JSON response or SocketSdkGenericResult based on options
   */
  async sendApi<T>(
    urlPath: string,
    options?: SendOptions | undefined,
  ): Promise<T | SocketSdkGenericResult<T>> {
    const {
      body,
      // Default to POST method for JSON API requests.
      method = 'POST',
      throws = true,
    } = { __proto__: null, ...options } as SendOptions

    try {
      // Route to appropriate HTTP method handler (POST or PUT).
      const response = await createRequestWithJson(
        method,
        this.#baseUrl,
        urlPath,
        body,
        this.#reqOptions,
      )

      const data = (await getResponseJson(response)) as T

      if (throws) {
        return data
      }

      return {
        cause: undefined,
        data,
        error: undefined,
        /* c8 ignore next - Defensive fallback: response.statusCode is always defined in Node.js http/https */
        status: response.statusCode ?? 200,
        success: true,
      }
    } catch (e) {
      if (throws) {
        throw e
      }

      /* c8 ignore start - Defensive fallback: ResponseError in catch block handled in try block (lines 1686-1695) */
      if (e instanceof ResponseError) {
        // Re-use existing error handling logic from the SDK
        const errorResult = await this.#handleApiError<never>(e)
        return {
          cause: errorResult.cause,
          data: undefined,
          error: errorResult.error,
          status: errorResult.status,
          success: false,
        }
      }
      /* c8 ignore stop */

      /* c8 ignore start - Defensive error stringification fallback branches for sendApi edge cases. */
      const errStr = e ? String(e).trim() : ''
      return {
        cause: errStr || UNKNOWN_ERROR,
        data: undefined,
        error: 'API request failed',
        status: 0,
        success: false,
      }
      /* c8 ignore stop */
    }
  }

  /**
   * Stream a full scan's results to file or stdout.
   *
   * Provides efficient streaming for large scan datasets without loading
   * entire response into memory. Useful for processing large SBOMs.
   *
   * @param orgSlug - Organization identifier
   * @param scanId - Full scan identifier
   * @param options - Streaming options (output file path, stdout, or buffered)
   * @returns Scan result with streaming response
   *
   * @example
   * ```typescript
   * // Stream to file
   * await sdk.streamFullScan('my-org', 'scan_123', {
   *   output: './scan-results.json'
   * })
   *
   * // Stream to stdout
   * await sdk.streamFullScan('my-org', 'scan_123', {
   *   output: true
   * })
   *
   * // Get buffered response
   * const result = await sdk.streamFullScan('my-org', 'scan_123')
   * ```
   *
   * @see https://docs.socket.dev/reference/getorgfullscan
   * @apiEndpoint GET /orgs/{org_slug}/full-scans/{full_scan_id}
   * @quota 1 unit
   * @scopes full-scans:list
   * @throws {Error} When server returns 5xx status codes
   */
  async streamFullScan(
    orgSlug: string,
    scanId: string,
    options?: StreamOrgFullScanOptions | undefined,
  ): Promise<SocketSdkResult<'getOrgFullScan'>> {
    const { output } = {
      __proto__: null,
      ...options,
    } as StreamOrgFullScanOptions
    try {
      const req = getHttpModule(this.#baseUrl)
        .request(
          `${this.#baseUrl}orgs/${encodeURIComponent(orgSlug)}/full-scans/${encodeURIComponent(scanId)}`,
          {
            method: 'GET',
            ...this.#reqOptions,
          },
        )
        .end()
      const res = await getResponse(req)

      // Check for HTTP error status codes.
      if (!isResponseOk(res)) {
        throw new ResponseError(res)
      }

      if (typeof output === 'string') {
        // Stream to file with size limit and error handling.
        const writeStream = createWriteStream(output)
        let bytesWritten = 0

        // Monitor stream size to prevent excessive disk usage.
        res.on('data', (chunk: Buffer) => {
          bytesWritten += chunk.length
          /* c8 ignore next 4 - Stream size limit enforcement, difficult to test reliably */
          if (bytesWritten > MAX_STREAM_SIZE) {
            res.destroy()
            writeStream.destroy()
            throw new Error(
              `Response exceeds maximum stream size of ${MAX_STREAM_SIZE} bytes`,
            )
          }
        })

        res.pipe(writeStream)
        /* c8 ignore next 4 - Write stream error handler, difficult to test reliably */
        writeStream.on('error', error => {
          throw new Error(`Failed to write to file: ${output}`, {
            cause: error,
          })
        })
      } else if (output === true) {
        // Stream to stdout with size limit and error handling.
        let bytesWritten = 0

        // Monitor stream size for stdout as well.
        res.on('data', (chunk: Buffer) => {
          bytesWritten += chunk.length
          /* c8 ignore next 3 - Stream size limit enforcement, difficult to test reliably */
          if (bytesWritten > MAX_STREAM_SIZE) {
            res.destroy()
            throw new Error(
              `Response exceeds maximum stream size of ${MAX_STREAM_SIZE} bytes`,
            )
          }
        })

        res.pipe(process.stdout)
        /* c8 ignore next 3 - Stdout error handler, difficult to test reliably */
        process.stdout.on('error', error => {
          throw new Error('Failed to write to stdout', { cause: error })
        })
      }

      // If output is false or undefined, just return the response without streaming
      return this.#handleApiSuccess<'getOrgFullScan'>(res)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'getOrgFullScan'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Stream patches for artifacts in a scan report.
   *
   * This method streams all available patches for artifacts in a scan.
   * Free tier users will only receive free patches.
   *
   * Note: This method returns a ReadableStream for processing large datasets.
   */
  async streamPatchesFromScan(
    orgSlug: string,
    scanId: string,
  ): Promise<ReadableStream<ArtifactPatches>> {
    const response = await this.#executeWithRetry(
      async () =>
        await createGetRequest(
          this.#baseUrl,
          `orgs/${encodeURIComponent(orgSlug)}/patches/scan?scan_id=${encodeURIComponent(scanId)}`,
          this.#reqOptions,
        ),
    )

    // Check for HTTP error status codes.
    if (!isResponseOk(response)) {
      throw new ResponseError(response, 'GET Request failed')
    }

    // Use readline for proper line buffering across chunks.
    // This prevents issues when NDJSON lines are split across multiple network chunks.
    const rli = readline.createInterface({
      input: response,
      crlfDelay: Number.POSITIVE_INFINITY,
    })

    // Convert the Node.js readable stream to a Web ReadableStream.
    return new ReadableStream<ArtifactPatches>({
      async start(controller) {
        try {
          for await (const line of rli) {
            const trimmed = line.trim()
            if (!trimmed) {
              continue
            }

            try {
              const data = JSON.parse(trimmed) as ArtifactPatches
              controller.enqueue(data)
            } catch (e) {
              /* c8 ignore next 2 - JSON parse error in streaming response, requires malformed server data */
              // Log parse errors for debugging invalid NDJSON lines.
              debugLog('streamPatchesFromScan', `Failed to parse line: ${e}`)
            }
          }
        } catch (error) {
          /* c8 ignore next - Streaming error handler, difficult to test reliably. */
          controller.error(error)
        } finally {
          controller.close()
        }
      },
    })
  }

  /**
   * Update alert triage status for an organization.
   * Modifies alert resolution status and triage decisions.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async updateOrgAlertTriage(
    orgSlug: string,
    alertId: string,
    triageData: QueryParams,
  ): Promise<SocketSdkResult<'updateOrgAlertTriage'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'PUT',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/triage/${encodeURIComponent(alertId)}`,
              triageData,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'updateOrgAlertTriage'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'updateOrgAlertTriage'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Update organization's license policy configuration.* Modifies allowed, restricted, and monitored license types.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async updateOrgLicensePolicy(
    orgSlug: string,
    policyData: QueryParams,
    queryParams?: QueryParams | undefined,
  ): Promise<SocketSdkResult<'updateOrgLicensePolicy'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/settings/license-policy?${queryToSearchParams(queryParams)}`,
              policyData,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'updateOrgLicensePolicy'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'updateOrgLicensePolicy'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Update configuration for a repository.
   *
   * Modifies monitoring settings, branch configuration, and scan preferences.
   *
   * @param orgSlug - Organization identifier
   * @param repoSlug - Repository slug/name
   * @param params - Configuration updates (description, homepage, default_branch, etc.)
   * @returns Updated repository details
   *
   * @example
   * ```typescript
   * const result = await sdk.updateRepository('my-org', 'my-repo', {
   *   description: 'Updated description',
   *   default_branch: 'develop'
   * })
   *
   * if (result.success) {
   *   console.log('Repository updated:', result.data.name)
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/updateorgrepo
   * @apiEndpoint POST /orgs/{org_slug}/repos/{repo_slug}
   * @quota 1 unit
   * @scopes repo:write
   * @throws {Error} When server returns 5xx status codes
   */
  async updateRepository(
    orgSlug: string,
    repoSlug: string,
    params?: QueryParams | undefined,
  ): Promise<RepositoryResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/repos/${encodeURIComponent(repoSlug)}`,
              params,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as RepositoryItem,
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'updateOrgRepo'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Update a repository label for an organization.
   *
   * Modifies label properties like name. Label names must be non-empty and less than 1000 characters.
   *
   * @param orgSlug - Organization identifier
   * @param labelId - Label identifier
   * @param labelData - Label updates (typically name property)
   * @returns Updated label with guaranteed id and name fields
   *
   * @example
   * ```typescript
   * const result = await sdk.updateRepositoryLabel('my-org', 'label-id-123', { name: 'staging' })
   *
   * if (result.success) {
   *   console.log('Label updated:', result.data.name)
   *   console.log('Label ID:', result.data.id)
   * }
   * ```
   *
   * @see https://docs.socket.dev/reference/updateorgrepolabel
   * @apiEndpoint PUT /orgs/{org_slug}/repos/labels/{label_id}
   * @quota 1 unit
   * @scopes repo-label:update
   * @throws {Error} When server returns 5xx status codes
   */
  async updateRepositoryLabel(
    orgSlug: string,
    labelId: string,
    labelData: QueryParams,
  ): Promise<RepositoryLabelResult | StrictErrorResult> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'PUT',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/repos/labels/${encodeURIComponent(labelId)}`,
              labelData,
              this.#reqOptions,
            ),
          ),
      )
      return {
        cause: undefined,
        data: data as RepositoryLabelItem,
        error: undefined,
        status: 200,
        success: true,
      }
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      const errorResult = await this.#handleApiError<'updateOrgRepoLabel'>(e)
      return {
        cause: errorResult.cause,
        data: undefined,
        error: errorResult.error,
        status: errorResult.status,
        success: false,
      }
    }
    /* c8 ignore stop */
  }

  /**
   * Update organization's security policy configuration.* Modifies alert rules, severity thresholds, and enforcement settings.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async updateOrgSecurityPolicy(
    orgSlug: string,
    policyData: QueryParams,
  ): Promise<SocketSdkResult<'updateOrgSecurityPolicy'>> {
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createRequestWithJson(
              'POST',
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/settings/security-policy`,
              policyData,
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<'updateOrgSecurityPolicy'>(data)
      /* c8 ignore start - Standard API error handling, tested via public method error cases */
    } catch (e) {
      return await this.#handleApiError<'updateOrgSecurityPolicy'>(e)
    }
    /* c8 ignore stop */
  }

  /**
   * Upload manifest files for dependency analysis.
   * Processes package files to create dependency snapshots and security analysis.
   *
   * @throws {Error} When server returns 5xx status codes
   */
  async uploadManifestFiles(
    orgSlug: string,
    filepaths: string[],
    options?: UploadManifestFilesOptions | undefined,
  ): Promise<UploadManifestFilesReturnType | UploadManifestFilesError> {
    const { pathsRelativeTo = '.' } = {
      __proto__: null,
      ...options,
    } as UploadManifestFilesOptions
    const basePath = resolveBasePath(pathsRelativeTo)
    const absFilepaths = resolveAbsPaths(filepaths, basePath)

    // Validate file readability before upload.
    const { invalidPaths, validPaths } = validateFiles(absFilepaths)

    // If callback provided and files were invalid, invoke it.
    if (this.#onFileValidation && invalidPaths.length > 0) {
      const result = await this.#onFileValidation(validPaths, invalidPaths, {
        operation: 'uploadManifestFiles',
        orgSlug,
      })

      if (!result.shouldContinue) {
        return {
          error: result.errorMessage ?? 'File validation failed',
          status: 400,
          success: false,
          ...(result.errorCause ? { cause: result.errorCause } : {}),
        } as UploadManifestFilesError
      }
    }

    // Default behavior if no callback: warn and continue.
    if (!this.#onFileValidation && invalidPaths.length > 0) {
      const samplePaths = invalidPaths.slice(0, 3).join('\n  - ')
      const remaining =
        invalidPaths.length > 3
          ? `\n  ... and ${invalidPaths.length - 3} more`
          : ''
      console.warn(
        `Warning: ${invalidPaths.length} files skipped (unreadable):\n  - ${samplePaths}${remaining}\n` +
          '→ This may occur with Yarn Berry PnP or pnpm symlinks.\n' +
          '→ Try: Run installation command to ensure files are accessible.',
      )
    }

    // Fail if all files were invalid.
    if (validPaths.length === 0) {
      const samplePaths = invalidPaths.slice(0, 5).join('\n  - ')
      const remaining =
        invalidPaths.length > 5
          ? `\n  ... and ${invalidPaths.length - 5} more`
          : ''
      return {
        cause: [
          `All ${invalidPaths.length} files failed validation:`,
          `  - ${samplePaths}${remaining}`,
          '',
          '→ Common causes:',
          '  ·Yarn Berry PnP virtual filesystem (files are not on disk)',
          '  ·pnpm symlinks pointing to inaccessible locations',
          '  ·Incorrect file permissions',
          '  ·Files were deleted after discovery',
          '',
          '→ Solutions:',
          '  ·Yarn Berry: Use `nodeLinker: node-modules` in .yarnrc.yml',
          '  ·pnpm: Use `node-linker=hoisted` in .npmrc',
          '  ·Check file permissions with: ls -la <file>',
          '  ·Run package manager install command',
        ].join('\n'),
        error: 'No readable manifest files found',
        status: 400,
        success: false,
      } as UploadManifestFilesError
    }

    // Continue with validated files.
    try {
      const data = await this.#executeWithRetry(
        async () =>
          await getResponseJson(
            await createUploadRequest(
              this.#baseUrl,
              `orgs/${encodeURIComponent(orgSlug)}/upload-manifest-files`,
              createRequestBodyForFilepaths(validPaths, basePath),
              this.#reqOptions,
            ),
          ),
      )
      return this.#handleApiSuccess<never>(
        data,
      ) as unknown as UploadManifestFilesReturnType
    } catch (e) {
      /* c8 ignore start - Error handling in uploadManifestFiles method for edge cases. */
      return (await this.#handleApiError<never>(
        e,
      )) as unknown as UploadManifestFilesError
      /* c8 ignore stop */
    }
  }

  /**
   * View detailed information about a specific patch by its UUID.
   *
   * This method retrieves comprehensive patch details including files,
   * vulnerabilities, description, license, and tier information.
   */
  async viewPatch(orgSlug: string, uuid: string): Promise<PatchViewResponse> {
    const data = await getResponseJson(
      await createGetRequest(
        this.#baseUrl,
        `orgs/${encodeURIComponent(orgSlug)}/patches/view/${encodeURIComponent(uuid)}`,
        this.#reqOptions,
      ),
    )

    return data as PatchViewResponse
  }

  /**
   * Download patch file content by hash.
   *
   * Downloads the actual patched file content from the public Socket blob store.
   * This is used after calling viewPatch() to get the patch metadata.
   * No authentication is required as patch blobs are publicly accessible.
   *
   * @param hash - The blob hash in SSRI (sha256-base64) or hex format
   * @param options - Optional configuration
   * @param options.baseUrl - Override blob store URL (for testing)
   * @returns Promise<string> - The patch file content as UTF-8 string
   * @throws Error if blob not found (404) or download fails
   *
   * @example
   * ```typescript
   * const sdk = new SocketSdk('your-api-token')
   * // First get patch metadata
   * const patch = await sdk.viewPatch('my-org', 'patch-uuid')
   * // Then download the actual patched file
   * const fileContent = await sdk.downloadPatch(patch.files['index.js'].socketBlob)
   * ```
   */
  async downloadPatch(
    hash: string,
    options?: { baseUrl?: string },
  ): Promise<string> {
    const https = await import('node:https')
    const http = await import('node:http')
    const blobPath = `/blob/${encodeURIComponent(hash)}`
    const blobBaseUrl = options?.baseUrl || SOCKET_PUBLIC_BLOB_STORE_URL
    const url = `${blobBaseUrl}${blobPath}`
    const isHttps = url.startsWith('https:')

    return await new Promise((resolve, reject) => {
      const client = isHttps ? https : http
      client
        .get(url, res => {
          if (res.statusCode === 404) {
            const message = [
              `Blob not found: ${hash}`,
              `→ URL: ${url}`,
              '→ The patch file may have expired or the hash is incorrect.',
              '→ Verify: The blob hash is correct.',
              '→ Note: Blob URLs may expire after a certain time period.',
            ].join('\n')
            reject(new Error(message))
            return
          }
          if (res.statusCode !== 200) {
            const message = [
              `Failed to download blob: ${res.statusCode} ${res.statusMessage}`,
              `→ Hash: ${hash}`,
              `→ URL: ${url}`,
              '→ The blob storage service may be temporarily unavailable.',
              res.statusCode && res.statusCode >= 500
                ? '→ Try: Retry the download after a short delay.'
                : '→ Verify: The blob hash and URL are correct.',
            ].join('\n')
            reject(new Error(message))
            return
          }

          let data = ''
          res.on('data', chunk => {
            data += chunk
          })
          res.on('end', () => {
            resolve(data)
          })
          /* c8 ignore next 3 - Response stream error during blob download, difficult to reliably trigger */
          res.on('error', err => {
            reject(err)
          })
        })
        .on('error', err => {
          const nodeErr = err as NodeJS.ErrnoException
          const message = [
            `Error downloading blob: ${hash}`,
            `→ URL: ${url}`,
            `→ Network error: ${nodeErr.message}`,
          ]

          // Add specific guidance based on error code.
          if (nodeErr.code === 'ENOTFOUND') {
            message.push(
              '→ DNS lookup failed. Cannot resolve blob storage hostname.',
              '→ Check: Internet connection and DNS settings.',
            )
          } else if (nodeErr.code === 'ECONNREFUSED') {
            message.push(
              '→ Connection refused. Blob storage service is unreachable.',
              '→ Check: Network connectivity and firewall settings.',
            )
          } else if (nodeErr.code === 'ETIMEDOUT') {
            message.push(
              '→ Connection timed out.',
              '→ Try: Check network connectivity and retry.',
            )
          } else if (nodeErr.code) {
            message.push(`→ Error code: ${nodeErr.code}`)
          }

          reject(new Error(message.join('\n'), { cause: err }))
        })
    })
  }
}

// Optional live heap trace.
/* c8 ignore start - optional debug logging for heap monitoring */
if (isDebugNs('heap')) {
  const used = process.memoryUsage()
  debugLog('heap', `heap used: ${Math.round(used.heapUsed / 1024 / 1024)}MB`)
}
/* c8 ignore stop - end debug logging */
