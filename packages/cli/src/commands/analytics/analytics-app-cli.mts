#!/usr/bin/env node
/** @fileoverview Standalone CLI wrapper for Ink AnalyticsApp. */

import { pathToFileURL } from 'node:url'

import { render } from 'ink'
import React from 'react'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Run the Ink AnalyticsApp with data from stdin.
 */
async function main() {
  // Read JSON data from stdin.
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const input = Buffer.concat(chunks).toString('utf8')
  const data = JSON.parse(input)

  // Dynamic import is needed here because AnalyticsApp.tsx gets compiled to .js at build time.
  const { AnalyticsApp } = await import(
    pathToFileURL(new URL('./AnalyticsApp.js', import.meta.url).pathname).href
  )

  // Render the Ink app.
  render(React.createElement(AnalyticsApp, { data: data.data }))
}

main().catch(e => {
  logger.error('Error running AnalyticsApp:', e)
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
})
