import chalk from 'chalk'
import isUnicodeSupported from 'is-unicode-supported'
import terminalLink from 'terminal-link'

// From the 'log-symbols' module
const unicodeLogSymbols = {
  info: chalk.blue('ℹ'),
  success: chalk.green('✔'),
  warning: chalk.yellow('⚠'),
  error: chalk.red('✖'),
}

// From the 'log-symbols' module
const fallbackLogSymbols = {
  info: chalk.blue('i'),
  success: chalk.green('√'),
  warning: chalk.yellow('‼'),
  error: chalk.red('×'),
}

// From the 'log-symbols' module
export const logSymbols = isUnicodeSupported() ? unicodeLogSymbols : fallbackLogSymbols

const markdownLogSymbols = {
  info: ':information_source:',
  error: ':stop_sign:',
  success: ':white_check_mark:',
  warning: ':warning:',
}

export class ChalkOrMarkdown {
  /** @type {boolean} */
  useMarkdown

  /**
   * @param {boolean} useMarkdown
   */
  constructor (useMarkdown) {
    this.useMarkdown = !!useMarkdown
  }

  /**
   * @param {string} text
   * @param {number} [level]
   * @returns {string}
   */
  header (text, level = 1) {
    return this.useMarkdown
      ? `\n${''.padStart(level, '#')} ${text}\n`
      : chalk.underline(`\n${level === 1 ? chalk.bold(text) : text}\n`)
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  bold (text) {
    return this.useMarkdown
      ? `**${text}**`
      : chalk.bold(`${text}`)
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  italic (text) {
    return this.useMarkdown
      ? `_${text}_`
      : chalk.italic(`${text}`)
  }

  /**
   * @param {string} text
   * @param {string|undefined} url
   * @param {{ fallback?: boolean, fallbackToUrl?: boolean }} options
   * @returns {string}
   */
  hyperlink (text, url, { fallback = true, fallbackToUrl } = {}) {
    if (!url) return text
    return this.useMarkdown
      ? `[${text}](${url})`
      : terminalLink(text, url, {
        fallback: fallbackToUrl ? (_text, url) => url : fallback
      })
  }

  /**
   * @param {string[]} items
   * @returns {string}
   */
  list (items) {
    const indentedContent = items.map(item => this.indent(item).trimStart())
    return this.useMarkdown
      ? '* ' + indentedContent.join('\n* ') + '\n'
      : indentedContent.join('\n') + '\n'
  }

  /**
   * @returns {typeof logSymbols}
   */
  get logSymbols () {
    return this.useMarkdown ? markdownLogSymbols : logSymbols
  }

  /**
   * @param {string} text
   * @param {number} [level]
   * @returns {string}
   */
  indent (text, level = 1) {
    const indent = ''.padStart(level * 2, ' ')
    return indent + text.split('\n').join('\n' + indent)
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  json (value) {
    return this.useMarkdown
      ? '```json\n' + JSON.stringify(value) + '\n```'
      : JSON.stringify(value)
  }
}
