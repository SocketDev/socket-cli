// Tokenizes a build-tool options string (e.g. the value of `--gradle-opts`,
// `--sbt-opts`, `--maven-opts`) into individual argv tokens. Splits on
// whitespace but honors single and double quotes so a value containing spaces,
// such as a settings path (`-s "my settings.xml"`), survives as one token
// instead of being shredded into three. Quotes are consumed (not emitted), and
// quoting is intra-token aware (`-Dkey="a b"` -> `-Dkey=a b`). For unquoted
// input this is equivalent to the previous whitespace split.
export function parseBuildToolOpts(opts: string | undefined): string[] {
  if (!opts) {
    return []
  }
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < opts.length; i += 1) {
    const ch = opts[i]
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
    } else if (ch === ' ' || ch === '\t') {
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
