/**
 * Socket Facts Integration Example
 *
 * Demonstrates how to use Socket Facts (reachability analysis) to enhance
 * CodeT5 prompts with vulnerability reachability context.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { SocketFacts } from '../src/types/socket-facts.mts'
import {
  estimateSocketFactsTokenCount,
  formatSocketFactsForCodeT5,
} from '../src/formatters/socket-facts.mts'

/**
 * Example 1: Basic Socket Facts formatting.
 */
async function basicExample(): Promise<void> {
  console.log('=== Example 1: Basic Socket Facts Formatting ===\n')

  // Load Socket Facts from file.
  const socketFactsPath = path.join(
    __dirname,
    '../test/fixtures/socket-facts-sample.json'
  )
  const socketFactsJson = await readFile(socketFactsPath, 'utf8')
  const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

  // Format for CodeT5.
  const prompt = formatSocketFactsForCodeT5(socketFacts)

  console.log(prompt)
  console.log(
    `\nToken count: ${estimateSocketFactsTokenCount(prompt)} tokens\n`
  )
}

/**
 * Example 2: Focus on reachable vulnerabilities only.
 */
async function reachableOnlyExample(): Promise<void> {
  console.log('\n=== Example 2: Reachable Vulnerabilities Only ===\n')

  const socketFactsPath = path.join(
    __dirname,
    '../test/fixtures/socket-facts-sample.json'
  )
  const socketFactsJson = await readFile(socketFactsPath, 'utf8')
  const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

  // Format with reachable-only filter.
  const prompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
    includeUnreachable: false,
    includeCallStacks: true,
    maxCallStackDepth: 5,
  })

  console.log(prompt)
  console.log(
    `\nToken count: ${estimateSocketFactsTokenCount(prompt)} tokens`
  )
  console.log('(Filtering unreachable vulnerabilities reduces noise)\n')
}

/**
 * Example 3: High-confidence reachability only.
 */
async function highConfidenceExample(): Promise<void> {
  console.log('\n=== Example 3: High-Confidence Reachability (>0.9) ===\n')

  const socketFactsPath = path.join(
    __dirname,
    '../test/fixtures/socket-facts-sample.json'
  )
  const socketFactsJson = await readFile(socketFactsPath, 'utf8')
  const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

  // Format with high confidence threshold.
  const prompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
    minConfidence: 0.9,
    includeUnreachable: false,
  })

  console.log(prompt)
  console.log(
    `\nToken count: ${estimateSocketFactsTokenCount(prompt)} tokens`
  )
  console.log('(High-confidence filter focuses on certain threats)\n')
}

/**
 * Example 4: Include unreachable vulnerabilities for comparison.
 */
async function compareReachabilityExample(): Promise<void> {
  console.log('\n=== Example 4: Compare Reachable vs Unreachable ===\n')

  const socketFactsPath = path.join(
    __dirname,
    '../test/fixtures/socket-facts-sample.json'
  )
  const socketFactsJson = await readFile(socketFactsPath, 'utf8')
  const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

  // Format with both reachable and unreachable.
  const prompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
    includeUnreachable: true,
    includeCallStacks: true,
  })

  console.log(prompt)
  console.log(
    `\nToken count: ${estimateSocketFactsTokenCount(prompt)} tokens\n`
  )
}

/**
 * Example 5: Different analysis tasks.
 */
async function differentTasksExample(): Promise<void> {
  console.log('\n=== Example 5: Different Analysis Tasks ===\n')

  const socketFactsPath = path.join(
    __dirname,
    '../test/fixtures/socket-facts-sample.json'
  )
  const socketFactsJson = await readFile(socketFactsPath, 'utf8')
  const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

  // Security analysis.
  console.log('--- Security Analysis ---\n')
  const securityPrompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
    task: 'security-analysis',
    includeUnreachable: false,
  })
  console.log(securityPrompt.slice(0, 500) + '...\n')

  // Vulnerability detection.
  console.log('--- Vulnerability Detection ---\n')
  const vulnPrompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
    task: 'vulnerability-detection',
    includeUnreachable: false,
  })
  console.log(vulnPrompt.slice(0, 500) + '...\n')

  // Dependency audit.
  console.log('--- Dependency Audit ---\n')
  const auditPrompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
    task: 'dependency-audit',
    includeUnreachable: false,
  })
  console.log(auditPrompt.slice(0, 500) + '...\n')
}

/**
 * Example 6: Token optimization comparison.
 */
async function tokenOptimizationExample(): Promise<void> {
  console.log('\n=== Example 6: Token Optimization Comparison ===\n')

  const socketFactsPath = path.join(
    __dirname,
    '../test/fixtures/socket-facts-sample.json'
  )
  const socketFactsJson = await readFile(socketFactsPath, 'utf8')
  const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

  // All vulnerabilities.
  const allPrompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
    includeUnreachable: true,
    includeCallStacks: true,
  })
  const allTokens = estimateSocketFactsTokenCount(allPrompt)

  // Reachable only.
  const reachablePrompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
    includeUnreachable: false,
    includeCallStacks: true,
  })
  const reachableTokens = estimateSocketFactsTokenCount(reachablePrompt)

  // Reachable only, no call stacks.
  const minimalPrompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
    includeUnreachable: false,
    includeCallStacks: false,
  })
  const minimalTokens = estimateSocketFactsTokenCount(minimalPrompt)

  console.log('Token Count Comparison:')
  console.log(`- All vulnerabilities (with call stacks): ${allTokens} tokens`)
  console.log(
    `- Reachable only (with call stacks): ${reachableTokens} tokens (${Math.round((1 - reachableTokens / allTokens) * 100)}% reduction)`
  )
  console.log(
    `- Reachable only (no call stacks): ${minimalTokens} tokens (${Math.round((1 - minimalTokens / allTokens) * 100)}% reduction)`
  )
  console.log('\nRecommendation: Use reachable-only with call stacks for best signal-to-noise ratio.')
}

/**
 * Run all examples.
 */
async function main(): Promise<void> {
  try {
    await basicExample()
    await reachableOnlyExample()
    await highConfidenceExample()
    await compareReachabilityExample()
    await differentTasksExample()
    await tokenOptimizationExample()
  } catch (error) {
    console.error('Error running examples:', error)
    process.exit(1)
  }
}

// Run examples.
main()
