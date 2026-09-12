export function parseMarkdownTableRows(markdown: string): string[][] {
  return markdown
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('|') && !/^\|[\s|:-]+$/.test(line))
    .map(line =>
      line
        .split('|')
        .slice(1, -1)
        .map(cell => cell.trim()),
    )
}
