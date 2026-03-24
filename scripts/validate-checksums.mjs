#!/usr/bin/env node

/**
 * @fileoverview Build-time validation for SHA-256 checksums.
 * Ensures all required platform-specific tool assets have checksums defined
 * in external-tools.json before building SEA binaries.
 *
 * This script is a security requirement - builds MUST NOT proceed if any
 * checksums are missing for downloadable binaries.
 *
 * Exit codes:
 * - 0: All required checksums are present.
 * - 1: One or more checksums are missing.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { PLATFORM_MAP_TOOLS } from '../packages/cli/scripts/constants/external-tools-platforms.mjs'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Load external tools configuration.
const externalToolsPath = path.join(
  rootPath,
  'packages/cli/external-tools.json',
)
const externalTools = JSON.parse(readFileSync(externalToolsPath, 'utf8'))

/**
 * Validate that all required checksums exist for external tools.
 * @returns {boolean} True if all checksums are valid, false otherwise.
 */
function validateChecksums() {
  const errors = []
  const warnings = []

  logger.info('Validating SHA-256 checksums for external tools...\n')

  // Track all unique assets that need checksums.
  const requiredAssets = new Map() // Map<toolName, Set<assetName>>

  // Collect all assets needed across all platforms.
  for (const [platform, tools] of Object.entries(PLATFORM_MAP_TOOLS)) {
    if (!tools) continue

    for (const [toolName, assetName] of Object.entries(tools)) {
      if (!assetName) continue

      if (!requiredAssets.has(toolName)) {
        requiredAssets.set(toolName, new Set())
      }
      requiredAssets.get(toolName).add(assetName)
    }
  }

  // Validate each tool's checksums.
  for (const [toolName, assets] of requiredAssets) {
    const toolConfig = externalTools[toolName]

    if (!toolConfig) {
      errors.push(`Tool "${toolName}" not found in external-tools.json`)
      continue
    }

    // Only GitHub release tools need checksums.
    if (toolConfig.type !== 'github-release') {
      continue
    }

    const checksums = toolConfig.checksums || {}
    const missingAssets = []

    for (const assetName of assets) {
      if (!checksums[assetName]) {
        missingAssets.push(assetName)
      }
    }

    if (missingAssets.length > 0) {
      errors.push(
        `Missing checksums for ${toolName}:\n` +
          missingAssets.map(a => `    - ${a}`).join('\n'),
      )
    } else {
      logger.success(`${toolName}: ${assets.size} asset checksum(s) verified`)
    }
  }

  // Check for extra checksums that aren't used (informational).
  for (const [toolName, toolConfig] of Object.entries(externalTools)) {
    if (toolConfig.type !== 'github-release' || !toolConfig.checksums) {
      continue
    }

    const usedAssets = requiredAssets.get(toolName) || new Set()
    const extraAssets = Object.keys(toolConfig.checksums).filter(
      asset => !usedAssets.has(asset),
    )

    if (extraAssets.length > 0) {
      warnings.push(
        `${toolName} has ${extraAssets.length} unused checksum(s) (may be for unsupported platforms)`,
      )
    }
  }

  // Print summary.
  console.log('')
  if (warnings.length > 0) {
    logger.warn('Warnings:')
    for (const warning of warnings) {
      logger.warn(`  ${warning}`)
    }
    console.log('')
  }

  if (errors.length > 0) {
    logger.error('CHECKSUM VALIDATION FAILED')
    console.log('')
    for (const error of errors) {
      logger.error(error)
    }
    console.log('')
    logger.error(
      'All external tool assets MUST have SHA-256 checksums defined in external-tools.json.',
    )
    logger.error('This is a security requirement to prevent supply chain attacks.')
    return false
  }

  logger.success('\nAll required checksums are present.')
  return true
}

// Run validation.
const valid = validateChecksums()
process.exit(valid ? 0 : 1)
