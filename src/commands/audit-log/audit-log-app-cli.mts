#!/usr/bin/env node
/** @fileoverview Standalone CLI wrapper for Ink AuditLogApp. */

import { pathToFileURL } from 'node:url'

/**
 * Run the Ink AuditLogApp with data from stdin.
 */
async function main() {
  // Read JSON data from stdin.
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const input = Buffer.concat(chunks).toString('utf8')
  const data = JSON.parse(input)

  // Dynamically import ESM modules.
  const React = await import('react')
  // @ts-expect-error - ink module not available currently
  const { render } = await import('ink')
  const { AuditLogApp } = await import(
    pathToFileURL(new URL('./AuditLogApp.js', import.meta.url).pathname).href
  )

  // Render the Ink app.
  render(
    React.createElement(AuditLogApp, {
      orgSlug: data.orgSlug,
      results: data.results,
    }),
  )
}

main().catch(e => {
  console.error('Error running AuditLogApp:', e)
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
})
