# Package lookups

## `socket package score`

Return the score for one package, including its transitive dependencies:

```sh
socket package score npm express@4.18.0
```

This command requires a Socket API token. The supported ecosystems include npm,
PyPI, NuGet, RubyGems, Go modules, and Maven. You can pass an ecosystem and
package name, or one package URL (PURL).

The `deep` subcommand is a hidden alias for `score`.

## `socket package shallow`

Return scores for one or more packages without including dependency scores:

```sh
socket package shallow npm express@4.18.0 lodash
```

Use this command when you need package-only scoring in a batch.

The root alias `pkg` routes to `package`.
