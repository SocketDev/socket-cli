# module-noun-name-guard

**Event:** PreToolUse (`Edit`, `Write`, `MultiEdit`) · **Type:** guard (blocks) · **Scope:** fleet repos only

Blocks **creating** a new `src/` module whose filename is a verb-phrase action — `trim-publish-manifest.ts`, `create-release.ts`, `fetch-packument.ts`. Fleet/socket-lib modules are concise **NOUN** names that group the related functions for a domain (`manifest.ts` holds `trimPublishManifest` + `createPackageJson`, reachable via one `exports` entry); we don't do one-method-per-file.

## Allowed (passes)

- Single-word names — `manifest.ts`, `normalize.ts`: a one-word verb reads as the domain.
- Noun-phrase names — `package-json.ts` (first segment isn't an action verb).
- Predicate prefixes — `is-number.ts`, `has-foo.ts`.
- Exempt stems — `index`, `types`, `constants`, `primordials`; `<module>.test.mts`; `.d.ts`.
- Anything outside a `src/` segment (scripts, config).
- Editing a file that already exists (creation-only; never disturbs prior layout).

## Bypass

Type `Allow module-noun-name bypass` for a deliberate exception.

See [`docs/agents.md/fleet/module-naming.md`](../../../../docs/agents.md/fleet/module-naming.md).
