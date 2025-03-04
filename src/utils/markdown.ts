export function mdTableStringNumber(
  title1: string,
  title2: string,
  obj: Record<string, number | string>
): string {
  // | Date        | Counts |
  // | ----------- | ------ |
  // | Header      | 201464 |
  // | Paragraph   |     18 |
  let mw1 = title1.length
  let mw2 = title2.length
  for (const [key, value] of Object.entries(obj)) {
    mw1 = Math.max(mw1, key.length)
    mw2 = Math.max(mw2, String(value ?? '').length)
  }

  const lines = []
  lines.push(`| ${title1.padEnd(mw1, ' ')} | ${title2.padEnd(mw2)} |`)
  lines.push(`| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} |`)
  for (const [key, value] of Object.entries(obj)) {
    lines.push(
      `| ${key.padEnd(mw1, ' ')} | ${String(value ?? '').padStart(mw2, ' ')} |`
    )
  }
  lines.push(`| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} |`)

  return lines.join('\n')
}

export function mdTable<T extends Array<Record<string, string>>>(
  logs: T,
  // This is saying "an array of strings and the strings are a valid key of elements of T"
  // In turn, T is defined above as the audit log event type from our OpenAPI docs.
  cols: Array<string & keyof T[number]>
): string {
  // Max col width required to fit all data in that column
  const cws = cols.map(col => col.length)

  for (const log of logs) {
    for (let i = 0; i < cols.length; ++i) {
      // @ts-ignore
      const val: unknown = log[cols[i] ?? ''] ?? ''
      cws[i] = Math.max(cws[i] ?? 0, String(val).length)
    }
  }

  let div = '|'
  for (const cw of cws) div += ' ' + '-'.repeat(cw) + ' |'

  let header = '|'
  for (let i = 0; i < cols.length; ++i)
    header += ' ' + String(cols[i]).padEnd(cws[i] ?? 0, ' ') + ' |'

  let body = ''
  for (const log of logs) {
    body += '|'
    for (let i = 0; i < cols.length; ++i) {
      // @ts-ignore
      const val: unknown = log[cols[i] ?? ''] ?? ''
      body += ' ' + String(val).padEnd(cws[i] ?? 0, ' ') + ' |'
    }
    body += '\n'
  }

  return [div, header, div, body.trim(), div].filter(s => !!s.trim()).join('\n')
}
