/** @fileoverview Common validation patterns to DRY out repetitive checks */

import { logger } from '@socketsecurity/registry/lib/logger'
import { hasDefaultApiToken } from './sdk.mts'
import { checkCommandInput } from './check-input.mts'
import constants from '../constants.mts'
import type { OutputKind } from '../types.mts'

/**
 * Common validation checks
 */
export const validations = {
  /**
   * Validate that we have an organization slug
   */
  requireOrg: (orgSlug: string | undefined, outputKind: OutputKind): boolean =>
    checkCommandInput(outputKind, {
      nook: true,
      test: !!orgSlug,
      message: 'Organization slug required (use --org or set default)',
      fail: 'missing',
    }),

  /**
   * Validate API token is present
   */
  requireAuth: (outputKind: OutputKind): boolean =>
    checkCommandInput(outputKind, {
      nook: true,
      test: hasDefaultApiToken(),
      message: 'This command requires authentication',
      fail: 'try `socket login`',
    }),

  /**
   * Validate mutually exclusive flags
   */
  notBoth: (
    flag1: boolean,
    flag2: boolean,
    name1: string,
    name2: string,
    outputKind: OutputKind,
  ): boolean =>
    checkCommandInput(outputKind, {
      nook: true,
      test: !(flag1 && flag2),
      message: `Cannot use both --${name1} and --${name2} flags`,
      fail: 'bad',
    }),

  /**
   * Validate enum value
   */
  isOneOf: <T extends unknown>(
    value: T,
    options: T[],
    name: string,
    outputKind: OutputKind,
  ): boolean =>
    checkCommandInput(outputKind, {
      nook: true,
      test: options.includes(value),
      message: `--${name} must be one of: ${options.join(', ')}`,
      fail: 'bad',
    }),

  /**
   * Validate positive number
   */
  isPositive: (value: number, name: string, outputKind: OutputKind): boolean =>
    checkCommandInput(outputKind, {
      nook: true,
      test: value > 0,
      message: `--${name} must be a positive number`,
      fail: 'bad',
    }),

  /**
   * Validate non-empty string
   */
  notEmpty: (value: string, name: string, outputKind: OutputKind): boolean =>
    checkCommandInput(outputKind, {
      nook: true,
      test: value.length > 0,
      message: `--${name} cannot be empty`,
      fail: 'missing',
    }),

  /**
   * Validate URL format
   */
  isUrl: (value: string, name: string, outputKind: OutputKind): boolean =>
    checkCommandInput(outputKind, {
      nook: true,
      test: /^https?:\/\/.+/.test(value),
      message: `--${name} must be a valid URL`,
      fail: 'bad',
    }),
}

/**
 * Standard validation workflow
 */
export interface ValidationOptions {
  requireAuth?: boolean
  requireOrg?: string | undefined
  dryRun?: boolean
  outputKind: OutputKind
  validations?: Array<() => boolean>
}

export function runStandardValidations(options: ValidationOptions): boolean {
  const {
    requireAuth: auth,
    requireOrg,
    dryRun,
    outputKind,
    validations: customValidations = [],
  } = options

  // Run custom validations first
  for (const validation of customValidations) {
    if (!validation()) {
      return false
    }
  }

  // Check org if required
  if (
    requireOrg !== undefined &&
    !validations.requireOrg(requireOrg, outputKind)
  ) {
    return false
  }

  // Handle dry run
  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return false
  }

  // Check auth if required (only after dry-run check)
  if (auth && !validations.requireAuth(outputKind)) {
    return false
  }

  return true
}

/**
 * Common parameter validators
 */
export const validateParams = {
  pagination: (
    page: number,
    perPage: number,
    outputKind: OutputKind,
  ): boolean => {
    return (
      validations.isPositive(page, 'page', outputKind) &&
      validations.isPositive(perPage, 'per-page', outputKind)
    )
  },

  sorting: (
    _sort: string,
    direction: string,
    outputKind: OutputKind,
  ): boolean => {
    return validations.isOneOf(
      direction,
      ['asc', 'desc'],
      'direction',
      outputKind,
    )
  },

  outputFlags: (
    json: boolean,
    markdown: boolean,
    outputKind: OutputKind,
  ): boolean => {
    return validations.notBoth(json, markdown, 'json', 'markdown', outputKind)
  },
}
