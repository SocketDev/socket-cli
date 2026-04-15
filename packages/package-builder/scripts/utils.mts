/**
 * Shared utilities for package generator scripts.
 */

import { promises as fs } from 'node:fs'

import Handlebars from 'handlebars'

/**
 * Copy directory recursively.
 *
 * @param {string} src - Source directory path.
 * @param {string} dest - Destination directory path.
 */
export async function copyDirectory(src, dest) {
  await fs.cp(src, dest, { recursive: true })
}

/**
 * Process template file with Handlebars.
 *
 * Reads a template file and compiles it with Handlebars, replacing
 * {{VARIABLE}} placeholders with values from the context object.
 *
 * @param {string} templatePath - Path to template file.
 * @param {Record<string, string>} context - Variables to inject into template.
 * @returns {Promise<string>} Rendered template content.
 *
 * @example
 * const content = await processTemplate('template.json', {
 *   PLATFORM: 'darwin',
 *   ARCH: 'arm64'
 * })
 */
export async function processTemplate(templatePath, context) {
  const content = await fs.readFile(templatePath, 'utf-8')

  // Compile and render template with Handlebars.
  const template = Handlebars.compile(content)
  return template(context)
}
