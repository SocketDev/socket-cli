# Error Messages — Worked Examples

Companion to the `## Error Messages` section of `CLAUDE.md`. That section
holds the rules; this file holds longer examples and anti-patterns that
would bloat CLAUDE.md if inlined.

## The four ingredients

Every message needs, in order:

1. **What** — the rule that was broken.
2. **Where** — the exact file, line, key, field, or CLI flag.
3. **Saw vs. wanted** — the bad value and the allowed shape or set.
4. **Fix** — one concrete action, in imperative voice.

## Library API errors (terse)

Callers may match on the message text, so stability matters. Aim for one
sentence.

| ✗ / ✓ | Message                                                                                                                                                                          | Notes                                                 |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| ✗     | `Error: invalid component`                                                                                                                                                       | No rule, no saw, no where.                            |
| ✗     | `The "name" component of type "npm" failed validation because the provided value "" is empty, which is not allowed because names are required; please provide a non-empty name.` | Restates the rule three times.                        |
| ✓     | `npm "name" component is required`                                                                                                                                               | Rule + where + implied saw (missing). Six words.      |
| ✗     | `Error: bad name`                                                                                                                                                                | No rule.                                              |
| ✓     | `name "__proto__" cannot start with an underscore`                                                                                                                               | Rule, where (`name`), saw (`__proto__`), fix implied. |
| ✗     | `Error: invalid argument`                                                                                                                                                        | No where, no rule, no fix.                            |
| ✓     | `orgSlug is required`                                                                                                                                                            | Rule + where (`orgSlug`), saw (missing), implies fix. |
| ✗     | `Error: request failed`                                                                                                                                                          | No status, no hint what to check.                     |
| ✓     | `Socket API rejected the token (401); check SOCKET_API_TOKEN`                                                                                                                    | Rule (401), where (token), fix (check env var).       |

## Validator / config / build-tool errors (verbose)

The reader is looking at a file and wants to fix the record without
re-running the tool. Give each ingredient its own words.

✗ `Error: invalid tour config`

✓ `tour.json: part 3 ("Parsing & Normalization") is missing "filename". Add a single-word lowercase filename (e.g. "parsing") to this part — one per part is required to route /<slug>/part/3 at publish time.`

Breakdown:

- **What**: `is missing "filename"` — the rule is "each part has a filename".
- **Where**: `tour.json: part 3 ("Parsing & Normalization")` — file + record + human label.
- **Saw vs. wanted**: saw = missing; wanted = a single-word lowercase filename, with `"parsing"` as a concrete model.
- **Fix**: `Add … to this part` — imperative, specific.

The trailing `to route /<slug>/part/3 at publish time` is optional. Include a _why_ clause only when the rule is non-obvious; skip it for rules the reader already knows (e.g. "names can't start with an underscore").

## Programmatic errors (terse, rule only)

Internal assertions and invariant checks. No end user will read them;
terse keeps the assertion readable when you skim the code.

- ✓ `assert(queue.length > 0)` with message `queue drained before worker exit`
- ✓ `pool size must be positive`
- ✗ `An unexpected error occurred while trying to acquire a connection from the pool because the pool size was not positive.` — nothing a maintainer can act on that the rule itself doesn't already say.

## Common anti-patterns

**"Invalid X" with no rule.**

- ✗ `Invalid filename 'My Part'`
- ✓ `filename 'My Part' must be [a-z]+ (lowercase, no spaces)`

**Passive voice on the fix.**

- ✗ `"filename" was missing`
- ✓ `add "filename" to part 3`

**Naming only one side of a collision.**

- ✗ `duplicate key "foo"` (which record won, which lost?)
- ✓ `duplicate key "foo" in config.json (lines 12 and 47) — rename one`

**Silently auto-correcting.**

- ✗ Stripping a trailing slash from a URL and continuing. The next run will hit the same bug; nothing learned.
- ✓ `url "https://api/" has a trailing slash — remove it`.

**Bloat that restates the rule.**

- ✗ `The value provided for "timeout" is invalid because timeouts must be positive numbers and the value you provided was not a positive number.`
- ✓ `timeout must be a positive number (saw: -5)`

## Formatting lists of values

When the error needs to show an allowed set, a list of conflicting
records, or multiple missing fields, use the list formatters from
`@socketsecurity/lib/arrays` rather than hand-joining with commas:

- `joinAnd(['a', 'b', 'c'])` → `"a, b, and c"` — for conjunctions ("missing foo, bar, and baz")
- `joinOr(['npm', 'pypi', 'maven'])` → `"npm, pypi, or maven"` — for disjunctions ("must be one of: …")

Both wrap `Intl.ListFormat`, so the Oxford comma and one-/two-item cases come out right for free (`joinOr(['a'])` → `"a"`; `joinOr(['a', 'b'])` → `"a or b"`).

- ✗ `--reach-ecosystems must be one of: npm, pypi, maven (saw: "foo")` — hand-joined, breaks if the list has one or two entries.
- ✓ `` `--reach-ecosystems must be one of: ${joinOr(ALLOWED)} (saw: "foo")` ``
- ✗ `missing keys: filename slug title` — no separators, no grammar.
- ✓ `` `missing keys: ${joinAnd(missing)}` `` → `"missing keys: filename, slug, and title"`

Use `joinOr` whenever the error is "must be one of X", `joinAnd` whenever it's "all of X are required / missing / in conflict".

## Working with caught values

`catch (e)` binds `unknown`. The helpers in `@socketsecurity/lib/errors` cover the four patterns that recur everywhere:

```ts
import {
  errorMessage,
  errorStack,
  isError,
  isErrnoException,
} from '@socketsecurity/lib/errors'
```

### `isError(value)` — replaces `value instanceof Error`

Cross-realm-safe. Uses the native ES2025 `Error.isError` when the engine ships it, falls back to a spec-compliant shim otherwise. Catches Errors from worker threads, `vm` contexts, and iframes that same-realm `instanceof Error` silently misses.

- ✗ `if (e instanceof Error) { … }`
- ✓ `if (isError(e)) { … }`

### `isErrnoException(value)` — replaces `'code' in err` guards

Narrows to `NodeJS.ErrnoException` (an Error with a string `code` set by libuv/syscalls like `ENOENT`, `EACCES`, `EBUSY`, `EPERM`). Builds on `isError`, so it's also cross-realm-safe, and it checks that `code` is a string — a merely branded Error without a real errno code returns `false`.

- ✗ `if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') { … }`
- ✓ `if (isErrnoException(e) && e.code === 'ENOENT') { … }`

### `errorMessage(value)` — replaces the `instanceof Error ? e.message : String(e)` pattern

Walks the `cause` chain via `messageWithCauses`, coerces primitives and objects to string, and returns the shared `UNKNOWN_ERROR` sentinel (the string `'Unknown error'`) for `null`, `undefined`, empty strings, `[object Object]`, or Errors with no message.

That last bullet is the important one: **every `|| 'Unknown error'` fallback in the fleet should collapse into a single `errorMessage(e)` call.**

- ✗ `` `Failed: ${e instanceof Error ? e.message : String(e)}` ``
- ✗ `` `Failed: ${(e as Error)?.message ?? 'Unknown error'}` ``
- ✗ `` `Failed: ${e instanceof Error ? e.message : 'Unknown error'}` ``
- ✓ `` `Failed: ${errorMessage(e)}` ``

When you want to preserve the cause chain upstream (recommended), pair it with `{ cause }`:

```ts
try {
  await readConfig(path)
} catch (e) {
  throw new Error(`Failed to read ${path}: ${errorMessage(e)}`, { cause: e })
}
```

### `errorStack(value)` — cause-aware stack, or `undefined`

Returns the cause-walking stack for Errors; returns `undefined` for non-Errors so logger calls stay safe:

```ts
logger.error(`rebuild failed: ${errorMessage(e)}`, { stack: errorStack(e) })
```

## Voice & tone

- Imperative for the fix: `rename`, `add`, `remove`, `set`.
- Present tense for the rule: `must be`, `cannot`, `is required`.
- No apology ("Sorry, …"), no blame ("You provided …"). State the rule and the fix.
- Don't end with "please"; it doesn't add information and it makes the message feel longer than it is.

## Bloat check

Before shipping a message, cross out any word that, if removed, leaves the information intact. If only rhythm or politeness disappears, drop it.
