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

| ✗ / ✓ | Message | Notes |
| --- | --- | --- |
| ✗ | `Error: invalid component` | No rule, no saw, no where. |
| ✗ | `The "name" component of type "npm" failed validation because the provided value "" is empty, which is not allowed because names are required; please provide a non-empty name.` | Restates the rule three times. |
| ✓ | `npm "name" component is required` | Rule + where + implied saw (missing). Six words. |
| ✗ | `Error: bad name` | No rule. |
| ✓ | `name "__proto__" cannot start with an underscore` | Rule, where (`name`), saw (`__proto__`), fix implied. |

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

The trailing `to route /<slug>/part/3 at publish time` is optional. Include a *why* clause only when the rule is non-obvious; skip it for rules the reader already knows (e.g. "names can't start with an underscore").

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

## Voice & tone

- Imperative for the fix: `rename`, `add`, `remove`, `set`.
- Present tense for the rule: `must be`, `cannot`, `is required`.
- No apology ("Sorry, …"), no blame ("You provided …"). State the rule and the fix.
- Don't end with "please"; it doesn't add information and it makes the message feel longer than it is.

## Bloat check

Before shipping a message, cross out any word that, if removed, leaves the information intact. If only rhythm or politeness disappears, drop it.
