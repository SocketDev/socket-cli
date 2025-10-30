#!/usr/bin/env node
/** @fileoverview Standalone CLI wrapper for Ink ThreatFeedApp. */

import { pathToFileURL } from 'node:url'

import { render } from 'ink'
import React from 'react'

/**
 * Run the Ink ThreatFeedApp with data from stdin.
 */
async function main() {
  // Read JSON data from stdin.
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const input = Buffer.concat(chunks).toString('utf8')
  const data = JSON.parse(input)

  // Dynamic import is needed here because ThreatFeedApp.tsx gets compiled to .js at build time.
  const { ThreatFeedApp } = await import(
    pathToFileURL(new URL('./ThreatFeedApp.js', import.meta.url).pathname).href
  )

  // Render the Ink app.
  render(React.createElement(ThreatFeedApp, { results: data.results }))
}

main().catch(e => {
  console.error('Error running ThreatFeedApp:', e)
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
})
