/**
 * Shared utilities for package generator scripts.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

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
 * Rename a copied dotless `gitignore` template seed to a real `.gitignore` in
 * the generated package. Templates store the seed dotless so it is not a
 * tracked nested `.gitignore` in this repo; the generated package needs the
 * dotted name.
 *
 * @param {string} packageDir - Generated package directory.
 */
export async function materializeGitignore(packageDir) {
  const seedPath = path.join(packageDir, 'gitignore')
  if (existsSync(seedPath)) {
    await fs.rename(seedPath, path.join(packageDir, '.gitignore'))
  }
}

/**
 * Process template file with Handlebars.
 *
 * Reads a template file and compiles it with Handlebars, replacing {{VARIABLE}}
 * placeholders with values from the context object.
 *
 * @example
 *   const content = await processTemplate('template.json', {
 *     PLATFORM: 'darwin',
 *     ARCH: 'arm64',
 *   })
 *
 * @param {string} templatePath - Path to template file.
 * @param {Record<string, string>} context - Variables to inject into template.
 *
 * @returns {Promise<string>} Rendered template content.
 */
export async function processTemplate(templatePath, context) {
  const content = await fs.readFile(templatePath, 'utf-8')

  // Compile and render template with Handlebars.
  const template = Handlebars.compile(content)
  return template(context)
}
