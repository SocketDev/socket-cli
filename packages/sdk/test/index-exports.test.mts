/** @fileoverview Tests for main module exports and public API surface. */
import { describe, expect, it } from 'vitest'

import * as sdk from '../src/index'

describe('index.ts exports', () => {
  it('should export all expected functions from http-client', () => {
    expect(typeof sdk.createDeleteRequest).toBe('function')
    expect(typeof sdk.createGetRequest).toBe('function')
    expect(typeof sdk.createRequestWithJson).toBe('function')
    expect(typeof sdk.getErrorResponseBody).toBe('function')
    expect(typeof sdk.getHttpModule).toBe('function')
    expect(typeof sdk.getResponse).toBe('function')
    expect(typeof sdk.getResponseJson).toBe('function')
    expect(typeof sdk.isResponseOk).toBe('function')
    expect(typeof sdk.reshapeArtifactForPublicPolicy).toBe('function')
    expect(sdk.ResponseError).toBeDefined()
    expect(typeof sdk.ResponseError).toBe('function')
  })

  it('should export all expected functions from file-upload', () => {
    expect(typeof sdk.createRequestBodyForFilepaths).toBe('function')
    expect(typeof sdk.createRequestBodyForJson).toBe('function')
    expect(typeof sdk.createUploadRequest).toBe('function')
  })

  it('should export SocketSdk class', () => {
    expect(sdk.SocketSdk).toBeDefined()
    expect(typeof sdk.SocketSdk).toBe('function')
  })

  it('should export user-agent function', () => {
    expect(typeof sdk.createUserAgentFromPkgJson).toBe('function')
  })

  it('should export all expected utility functions', () => {
    expect(typeof sdk.normalizeBaseUrl).toBe('function')
    expect(typeof sdk.promiseWithResolvers).toBe('function')
    expect(typeof sdk.queryToSearchParams).toBe('function')
    expect(typeof sdk.resolveAbsPaths).toBe('function')
    expect(typeof sdk.resolveBasePath).toBe('function')
  })

  it('should export all expected constants', () => {
    expect(typeof sdk.DEFAULT_USER_AGENT).toBe('string')
    expect(sdk.httpAgentNames).toBeInstanceOf(Set)
    expect(sdk.publicPolicy).toBeInstanceOf(Map)
  })

  it('should have a comprehensive export list', () => {
    const expectedExports = [
      // HTTP client functions
      'createDeleteRequest',
      'createGetRequest',
      'createRequestWithJson',
      'getErrorResponseBody',
      'getHttpModule',
      'getResponse',
      'getResponseJson',
      'isResponseOk',
      'reshapeArtifactForPublicPolicy',
      'ResponseError',

      // File upload functions
      'createRequestBodyForFilepaths',
      'createRequestBodyForJson',
      'createUploadRequest',

      // Main SDK class
      'SocketSdk',

      // Quota utility functions
      'calculateTotalQuotaCost',
      'getAllMethodRequirements',
      'getMethodRequirements',
      'getMethodsByPermissions',
      'getMethodsByQuotaCost',
      'getQuotaCost',
      'getQuotaUsageSummary',
      'getRequiredPermissions',
      'hasQuotaForMethods',

      // User agent function
      'createUserAgentFromPkgJson',

      // Utility functions
      'normalizeBaseUrl',
      'promiseWithResolvers',
      'queryToSearchParams',
      'resolveAbsPaths',
      'resolveBasePath',

      // Constants
      'DEFAULT_USER_AGENT',
      'httpAgentNames',
      'publicPolicy',
    ]

    for (const exportName of expectedExports) {
      expect(sdk).toHaveProperty(exportName)
    }
  })

  it('should not export unexpected functions', () => {
    const sdkKeys = Object.keys(sdk)
    const expectedKeys = new Set([
      'createDeleteRequest',
      'createGetRequest',
      'createRequestWithJson',
      'getErrorResponseBody',
      'getHttpModule',
      'getResponse',
      'getResponseJson',
      'isResponseOk',
      'reshapeArtifactForPublicPolicy',
      'ResponseError',
      'createRequestBodyForFilepaths',
      'createRequestBodyForJson',
      'createUploadRequest',
      'SocketSdk',
      'calculateTotalQuotaCost',
      'getAllMethodRequirements',
      'getMethodRequirements',
      'getMethodsByPermissions',
      'getMethodsByQuotaCost',
      'getQuotaCost',
      'getQuotaUsageSummary',
      'getRequiredPermissions',
      'hasQuotaForMethods',
      'createUserAgentFromPkgJson',
      'normalizeBaseUrl',
      'promiseWithResolvers',
      'queryToSearchParams',
      'resolveAbsPaths',
      'resolveBasePath',
      'DEFAULT_USER_AGENT',
      'httpAgentNames',
      'publicPolicy',
    ])

    // Check that we don't have unexpected exports (CommonJS build adds 'default')
    const unexpectedExports = sdkKeys.filter(
      key => !expectedKeys.has(key) && key !== 'default',
    )
    expect(unexpectedExports).toEqual([])
  })
})
