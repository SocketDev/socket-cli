import terminalLink from 'terminal-link'
import colors from 'yoctocolors-cjs'

import indentString from '@socketregistry/indent-string/index.cjs'

export class ColorOrMarkdown {
  public useMarkdown: boolean

  constructor(useMarkdown: boolean) {
    this.useMarkdown = !!useMarkdown
  }

  bold(text: string): string {
    return this.useMarkdown ? `**${text}**` : colors.bold(`${text}`)
  }

  header(text: string, level = 1): string {
    return this.useMarkdown
      ? `\n${''.padStart(level, '#')} ${text}\n`
      : colors.underline(`\n${level === 1 ? colors.bold(text) : text}\n`)
  }

  hyperlink(
    text: string,
    url: string | undefined,
    {
      fallback = true,
      fallbackToUrl
    }: {
      fallback?: boolean | undefined
      fallbackToUrl?: boolean | undefined
    } = {}
  ) {
    if (url) {
      return this.useMarkdown
        ? `[${text}](${url})`
        : terminalLink(text, url, {
            fallback: fallbackToUrl ? (_text, url) => url : fallback
          })
    }
    return text
  }

  indent(
    ...args: Parameters<typeof indentString>
  ): ReturnType<typeof indentString> {
    return indentString(...args)
  }

  italic(text: string): string {
    return this.useMarkdown ? `_${text}_` : colors.italic(`${text}`)
  }

  json(value: any): string {
    return this.useMarkdown
      ? '```json\n' + JSON.stringify(value) + '\n```'
      : JSON.stringify(value)
  }

  list(items: string[]): string {
    const indentedContent = items.map(item => this.indent(item).trimStart())
    return this.useMarkdown
      ? `* ${indentedContent.join('\n* ')}\n`
      : `${indentedContent.join('\n')}\n`
  }
}
