# No underscore-prefixed identifiers

## What

Never prefix a function, variable, type, or export name with `_` to signal
privacy or "internal use." An `_internal/` directory name is the one allowed
exception - it marks a module-private directory, not an identifier.

## Why

An underscore prefix is a convention, not a boundary - nothing stops another
file from importing `_helper` anyway, so the marker lies about the guarantee it
claims to give. Privacy in the fleet comes from one of two real mechanisms:

- **Module boundaries.** Don't export the symbol at all; consumers that need it
  reach through the public API instead.
- **An `_internal/` directory.** Files under it are understood to be
  module-private by location, not by a per-name marker on every symbol inside.

A leading underscore also collides with the fleet's export-everything
discipline (see [`export-and-no-any.md`](export-and-no-any.md)): every
top-level `src/` symbol is exported, so an underscore-prefixed "private"
export is a contradiction in terms - either it's exported and reachable, or
it isn't exported and needs no naming trick to hide it.

## How to apply

- Reach for `_internal/` when a group of files is genuinely module-private.
- Reach for "don't export it" when a single symbol is private.
- Never reach for a leading underscore on a function, variable, type, class, or
  export name to mean either of the above.

## Enforcement

- `.claude/hooks/fleet/no-underscore-ident-guard/` - PreToolUse Edit/Write:
  blocks introducing a new underscore-prefixed identifier (function, variable,
  type, or export). The `_internal/` directory name itself is allowed.

## Why this is codified

Privacy-by-underscore is a convention that erodes the moment someone imports
across the boundary it claims to protect. Codifying "no underscore, use
`_internal/` or don't export" removes the false sense of safety a leading
underscore gives without actually stopping anyone from reaching in.
