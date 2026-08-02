/*
 * @file Read process-spawn and environment-write sites out of source text,
 *   for Rust and JS/TS alike. Extracted from `test-isolation-law.mts`, whose
 *   three clauses are all statements about the ORDER of env writes around a
 *   spawn; this module answers "where are they", the law answers "is that
 *   allowed". Keeping the two apart also keeps the law readable as a law.
 *   Line-based and deliberately shallow — no parser dependency, so it runs in
 *   a hook where an AST parse would not. That costs precision in three known
 *   ways, each of which mis-scopes a finding rather than inventing one:
 *   a raw string holding an unbalanced brace confuses the depth walk, a
 *   program held in a variable reads as an empty program name, and a builder
 *   assembled across two functions is seen as two unrelated regions.
 */

/**
 * One function-shaped region of a source file.
 */
export interface SourceFunction {
  /**
   * The signature line through the closing brace, verbatim.
   */
  bodyLines: readonly string[]
  /**
   * 1-based line number of `bodyLines[0]`.
   */
  firstLine: number
  name: string
}

// A Rust `fn name(` or a JS/TS `function name(`, at any indent, with the
// visibility/async/unsafe/export prefixes each language allows. Two
// alternatives, so the name lands in group 1 (Rust) or group 2 (JS/TS).
const FN_RE =
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)|^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/
// An env WRITE, two shapes. Rust/builder: `.env("KEY", value)` / `.env(k, v)`
// / `.envs(map)`, key captured only when it is a literal. JS assignment:
// `env.KEY = v` / `env["KEY"] = v` / `process.env.KEY = v`, with the `[^=]`
// tail keeping `==` and `===` comparisons out. A key written inside an object
// LITERAL (`{ ...process.env, HOME: dir }`) is not a write this sees.
const ENV_SET_RE =
  /\.envs?\(\s*(?:"([^"]*)"|'([^']*)')?|\b(?:process\.)?env(?:\[\s*['"]([^'"]+)['"]\s*\]|\.([A-Za-z_$][\w$]*))\s*=[^=]/
// `.env_remove("KEY")` (Rust) and `delete env["KEY"]` / `delete process.env.KEY`
// (JS/TS) — an env REMOVAL naming one key.
const ENV_REMOVE_RE =
  /\.env_remove\(\s*(?:"([^"]+)"|'([^']+)')|delete\s+(?:process\.)?env(?:\[\s*['"]([^'"]+)['"]\s*\]|\.([A-Za-z_$][\w$]*))/
// A spawn: Rust `Command::new(x)` or a node child-process call. The program is
// captured when it is a string literal; a variable or expression leaves every
// group empty, which callers read as "program unknown".
const SPAWN_RE =
  /\bCommand::new\(\s*(?:"([^"]*)")?|\b(?:execFileSync|execFile|spawnSync|spawn)\(\s*(?:"([^"]*)"|'([^']*)')?/

// Line content with `//` comments and string bodies blanked, so brace-depth
// counting is not thrown by a brace inside a comment or a literal.
function stripNoise(line: string): string {
  return (
    line
      // A double-quoted literal: the quote, then any run of non-quote,
      // non-backslash characters or backslash-escaped pairs, then the closing
      // quote. The escape arm is what stops \" from ending the match early.
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      // Same shape for a single-quoted literal.
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/\/\/.*$/, '')
  )
}

/**
 * Every function-shaped region in the source, in document order. A nested
 * function is not split out — a closure's body belongs to the function that
 * holds it, which is the scope an ordering rule is about anyway.
 */
export function sourceFunctions(source: string): SourceFunction[] {
  const found: SourceFunction[] = []
  const lines = source.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const match = FN_RE.exec(lines[i]!)
    const name = match?.[1] ?? match?.[2]
    if (!name) {
      continue
    }
    let depth = 0
    let end = i
    let opened = false
    for (let j = i; j < length; j += 1) {
      const text = stripNoise(lines[j]!)
      for (let k = 0, textLength = text.length; k < textLength; k += 1) {
        const char = text[k]
        if (char === '{') {
          depth += 1
          opened = true
        } else if (char === '}') {
          depth -= 1
        }
      }
      end = j
      if (opened && depth <= 0) {
        break
      }
    }
    if (!opened) {
      continue
    }
    found.push({ bodyLines: lines.slice(i, end + 1), firstLine: i + 1, name })
    i = end
  }
  return found
}

/**
 * The environment variable one line removes by literal name, or undefined. A
 * prefix scrub (`if k.starts_with("SOCKET_") { cmd.env_remove(k) }`) names no
 * literal and returns undefined.
 */
export function envRemovedKey(line: string): string | undefined {
  const match = ENV_REMOVE_RE.exec(line)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4]
}

/**
 * Every variable a body removes by literal name, in source order.
 */
export function envRemovedKeys(bodyLines: readonly string[]): string[] {
  const keys: string[] = []
  for (let i = 0, { length } = bodyLines; i < length; i += 1) {
    const key = envRemovedKey(bodyLines[i]!)
    if (key) {
      keys.push(key)
    }
  }
  return keys
}

/**
 * How one line writes the environment: `undefined` when it does not, the
 * literal key when it names one, and the empty string when it writes a key
 * the source does not spell out (`cmd.env(k, v)` inside a loop). A key set
 * inside an object literal (`{ ...process.env, HOME: dir }`) is not a write
 * this sees; the assignment form (`env.HOME = dir`) is.
 */
export function envSetKey(line: string): string | undefined {
  const match = ENV_SET_RE.exec(line)
  if (!match) {
    return undefined
  }
  return match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
}

/**
 * The program one line spawns: the literal name, the empty string when the
 * program is an expression, or `undefined` when the line spawns nothing.
 */
export function spawnProgram(line: string): string | undefined {
  const match = SPAWN_RE.exec(line)
  if (!match) {
    return undefined
  }
  return match[1] ?? match[2] ?? match[3] ?? ''
}
