export function mdTableStringNumber(
  obj: Record<string, number | string>
): string {
  // | Date        | Counts |
  // | ----------- | ------ |
  // | Header      | 201464 |
  // | Paragraph   |     18 |
  let mw1 = 4
  let mw2 = 6
  for (const [key, value] of Object.entries(obj)) {
    mw1 = Math.max(mw1, key.length)
    mw2 = Math.max(mw2, String(value ?? '').length)
  }

  const lines = []
  lines.push(`| Date${' '.repeat(mw1 - 4)} | Count${' '.repeat(mw2 - 6)} |`)
  lines.push(`| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} |`)
  for (const [key, value] of Object.entries(obj)) {
    lines.push(
      `| ${key.padEnd(mw1, ' ')} | ${String(value ?? '').padStart(mw2, ' ')} |`
    )
  }
  lines.push(`| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} |`)

  return lines.join('\n')
}
