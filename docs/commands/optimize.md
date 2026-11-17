# `socket optimize`

Add or update `@socketregistry` package overrides in the current project. The
command requires a valid `package.json` and a nonempty lockfile. It updates
the lockfile when needed.

```sh
socket optimize
socket optimize ./path/to/project --pin
```

By default, overrides apply to production and development dependencies. Use
`--prod` to limit them to production dependencies on supported package
managers. Bun and Yarn Berry do not support `--prod`. Use `--pin` to pin
overrides to the latest version.
