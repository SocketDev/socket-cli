// Tokenizes a build-tool options string, e.g. the value of `--gradle-opts`,
// `--sbt-opts`, or `--maven-opts`, into individual argv tokens. Splits on
// whitespace but honors single and double quotes so a value containing spaces,
// such as a settings path (`-s "my settings.xml"`), survives as one token
// instead of being shredded into three. Quotes are consumed rather than
// emitted, and quoting is intra-token aware (`-Dkey="a b"` -> `-Dkey=a b`).
// Unquoted input tokenizes as a plain whitespace split.
export function parseBuildToolOpts(raw: string | undefined): string[] {
  if (!raw) {
    return []
  }
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let inSingle = false
  let inDouble = false
  for (let i = 0, { length } = raw; i < length; i += 1) {
    const ch = raw[i]
    if (inSingle) {
      if (ch === "'") {
        inSingle = false
      } else {
        current += ch
      }
    } else if (inDouble) {
      if (ch === '"') {
        inDouble = false
      } else {
        current += ch
      }
    } else if (ch === "'") {
      inSingle = true
      hasToken = true
    } else if (ch === '"') {
      inDouble = true
      hasToken = true
    } else if (ch === '\t' || ch === ' ') {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
    } else {
      current += ch
      hasToken = true
    }
  }
  if (hasToken) {
    tokens.push(current)
  }
  return tokens
}
