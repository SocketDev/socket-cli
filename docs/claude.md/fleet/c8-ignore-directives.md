# c8 / v8 coverage ignore directives

`c8 ignore next N` does not work the way the name implies for multi-line code. Use `c8 ignore start` / `c8 ignore stop` brackets for any body that spans more than one line.

## The bug

`/* c8 ignore next */` is documented as "ignore the next statement," but the c8/v8 reporter implementation treats it as "ignore the next **line**." A catch arm whose body spans three lines:

```ts
} catch {
  /* c8 ignore next - rarely throws */
  logger.warn(`unexpected: ${e}`)
}
```

…ignores only the `logger.warn(...` line. The closing `}` and any preceding setup statements stay counted as uncovered. `c8 ignore next 3` is no better. It counts physical lines from the directive, so the comment line itself is hop #0, then the next two lines, then the directive's coverage runs out before the body ends.

This makes the directive functionally useless for the most common case: skipping a `catch` block that logs and returns. The reporter quietly reports the body as uncovered no matter what number you pass to `next`.

## The fix

Switch to start/stop brackets, which cover everything between them regardless of line count:

```ts
/* c8 ignore start - rarely throws; defensive log path */
} catch {
  logger.warn(`unexpected: ${e}`)
}
/* c8 ignore stop */
```

Place `start` on the line **before** the construct, `stop` on the line **after**. The reporter treats every statement between them as ignored, end of story.

## Where to apply

Any of these patterns:

```ts
// Multi-line catch body
} catch (e) {
  /* c8 ignore next ... */    // ❌ only ignores logger.warn line
  logger.warn(...)
  return defaultValue
}

// Multi-line return after a comment
if (cond) {
  /* c8 ignore next ... */    // ❌ comment is line 0, return is line 1
  return undefined
}

// Multi-line module-init IIFE catch
const x = (() => {
  try { return resolve() } catch {
    /* c8 ignore next ... */  // ❌ body has setup + return
    cleanup()
    return undefined
  }
})()
```

Convert each to:

```ts
/* c8 ignore start - <reason> */
} catch (e) {
  logger.warn(...)
  return defaultValue
}
/* c8 ignore stop */
```

## Single-line uses are fine

`/* c8 ignore next */` works correctly when the next physical line **is** the entire statement:

```ts
/* c8 ignore next */
return undefined
```

That one line. No body, no follow-on statements. The directive does what its name says here. The bug only bites when the construct it's meant to ignore spans multiple lines.

## Real-world impact

A coverage report can show a cluster of "uncovered" lines that all carry a `c8 ignore next N` directive directly above them. Converting those directives to start/stop blocks lifts the reported number with zero test changes. The "uncovered" lines weren't untested code. They were defensive arms that c8 had been instructed to ignore but the reporter quietly kept counting because the directive form was wrong.

The bug is in the c8/v8 reporter's directive parser, not in any user code; until upstream fixes it, the fleet rule is **always use start/stop brackets for multi-line bodies, even when `next N` would seem to suffice.**

## Reason

> When a coverage report flags a batch of "uncovered" lines that all carry a `c8 ignore next N` directive directly above them, converting every one to a `c8 ignore start` / `c8 ignore stop` block recovers the coverage with zero test changes. The lines were correctly marked as untestable defensive arms all along; the reporter wasn't honoring the line-counting directive form. This compound lesson promotes the workaround to a fleet rule.
