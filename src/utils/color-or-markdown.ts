import isUnicodeSupported from 'is-unicode-supported'
import terminalLink from 'terminal-link'
import colors from 'yoctocolors-cjs'

// From the 'log-symbols' module
const unicodeLogSymbols = {
  __proto__: null,
  info: colors.blue('ℹ'),
  success: colors.green('✔'),
  warning: colors.yellow('⚠'),
  error: colors.red('✖')
}

// From the 'log-symbols' module
const fallbackLogSymbols = {
  __proto__: null,
  info: colors.blue('i'),
  success: colors.green('√'),
  warning: colors.yellow('‼'),
  error: colors.red('×')
}

// From the 'log-symbols' module
export const logSymbols = isUnicodeSupported()
  ? unicodeLogSymbols
  : fallbackLogSymbols

const markdownLogSymbols = {
  __proto__: null,
  info: ':information_source:',
  error: ':stop_sign:',
  success: ':white_check_mark:',
  warning: ':warning:'
}

export class ColorOrMarkdown {
  public useMarkdown: boolean

  constructor(useMarkdown: boolean) {
    this.useMarkdown = !!useMarkdown
  }

  header(text: string, level = 1): string {
    return this.useMarkdown
      ? `\n${''.padStart(level, '#')} ${text}\n`
      : colors.underline(`\n${level === 1 ? colors.bold(text) : text}\n`)
  }

  bold(text: string): string {
    return this.useMarkdown ? `**${text}**` : colors.bold(`${text}`)
  }

  italic(text: string): string {
    return this.useMarkdown ? `_${text}_` : colors.italic(`${text}`)
  }

  hyperlink(
    text: string,
    url: string | undefined,
    {
      fallback = true,
      fallbackToUrl
    }: {
      fallback?: boolean
      fallbackToUrl?: boolean
    } = {}
  ) {
    if (!url) return text
    return this.useMarkdown
      ? `[${text}](${url})`
      : terminalLink(text, url, {
          fallback: fallbackToUrl ? (_text, url) => url : fallback
        })
  }

  list(items: string[]): string {
    const indentedContent = items.map(item => this.indent(item).trimStart())
    return this.useMarkdown
      ? `* ${indentedContent.join('\n* ')}\n`
      : `${indentedContent.join('\n')}\n`
  }

  get logSymbols(): typeof logSymbols {
    return this.useMarkdown ? markdownLogSymbols : logSymbols
  }

  indent(text: string, level = 1): string {
    const indent = ''.padStart(level * 2, ' ')
    return indent + text.split('\n').join('\n' + indent)
  }

  json(value: unknown): string {
    return this.useMarkdown
      ? '```json\n' + JSON.stringify(value) + '\n```'
      : JSON.stringify(value)
  }
}
