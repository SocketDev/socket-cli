/** @typedef {string|{ description: string }} ListDescription */

/**
 * @typedef HelpListOptions
 * @property {string} [keyPrefix]
 * @property {number} [padName]
 */

/**
 * @param {Record<string,ListDescription>} list
 * @param {number} indent
 * @param {HelpListOptions} options
 * @returns {string}
 */
export function printHelpList (list, indent, options = {}) {
  const {
    keyPrefix = '',
    padName = 18,
  } = options

  const names = Object.keys(list).sort()

  let result = ''

  for (const name of names) {
    const rawDescription = list[name]
    const description = (typeof rawDescription === 'object' ? rawDescription.description : rawDescription) || ''

    result += ''.padEnd(indent) + (keyPrefix + name).padEnd(padName) + description + '\n'
  }

  return result.trim()
}

/**
 * @param {Record<string, ListDescription>} list
 * @param {number} indent
 * @param {HelpListOptions} options
 * @returns {string}
 */
export function printFlagList (list, indent, options = {}) {
  return printHelpList({
    'help': 'Print this help and exits.',
    'version': 'Prints current version and exits.',
    ...list,
  }, indent, { keyPrefix: '--', ...options })
}
