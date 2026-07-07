# Module naming

Fleet/socket-lib source modules are **concise NOUN names that group the related functions for a domain** — not one-method-per-file, and never named after the verb phrase of the single function they hold.

## The rule

- A module file's name is the **domain noun**: `manifest.ts`, `exports.ts`, `tarball.ts`, `normalize.ts`, `validation.ts`.
- Related functions for that domain live **inside** it. `manifest.ts` holds `createPackageJson`, `fetchPackageManifest`, `fetchPackagePackument`, and `trimPublishManifest` — all reachable through that module's single `exports` entry (`./packages/manifest`).
- A new helper **extends an existing related module** rather than spawning its own file. Add `trimPublishManifest` to `manifest.ts`; do not create `trim-publish-manifest.ts`.

## What's wrong with verb-phrase files

`trim-publish-manifest.ts`, `create-release.ts`, `generate-notes.ts`, `fetch-packument.ts` each:

- fragment one domain across a dozen tiny files,
- multiply the hand-maintained `exports` map (one entry per file),
- bury the noun a reader is actually scanning for under an action verb.

Grouping by noun keeps the public surface small and the related code co-located.

## Enforcement

`module-noun-name-guard` (PreToolUse Write, fleet-scoped) blocks **creating** a new `src/` module whose filename is a kebab phrase **led by an action verb** (`trim`, `create`, `fetch`, `generate`, `make`, `get`, …).

- **Single-word names are always allowed** — a one-word verb like `normalize` reads as the domain itself.
- **Predicate prefixes are allowed** — `is-`, `has-`, `can-`, `should-` are not treated as action verbs.
- **Creation-only** — editing a file that predates the rule is never blocked; the guard never disturbs existing layout.
- Exempt structural stems: `index`, `types`, `constants`, `primordials`; tests own their own `<module>.test.mts` naming.

Bypass a deliberate exception with `Allow module-noun-name bypass`.
