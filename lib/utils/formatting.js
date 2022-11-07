/** @typedef {string|{ description: string }} ListDescription */

/**
 * @param {Record<string,ListDescription>} list
 * @param {number} indent
 * @param {number} padName
 * @returns {string}
 */
export function printHelpList (list, indent, padName = 18) {
  const names = Object.keys(list).sort()

  let result = ''

  for (const name of names) {
    const rawDescription = list[name]
    const description = (typeof rawDescription === 'object' ? rawDescription.description : rawDescription) || ''

    result += ''.padEnd(indent) + name.padEnd(padName) + description + '\n'
  }

  return result.trim()
}

/**
 * @param {Record<string,ListDescription>} list
 * @param {number} indent
 * @param {number} padName
 * @returns {string}
 */
 export function printFlagList (list, indent, padName = 18) {
  return printHelpList({
    '--help': 'Print this help and exits.',
    '--version': 'Prints current version and exits.',
    ...list,
  }, indent, padName)
}
