# `socket npx`

Run npx through Socket's package security checks.

```sh
socket npx cowsay
socket npx cowsay@1.6.0 hello
```

`--help` shows the wrapper help. `--dry-run` exits before running npx.

The wrapper can use Socket's default public API token. A custom token needs
the `packages:list` permission.

Run `socket wrapper on` to add both `npm` and `npx` aliases to a supported Bash
or Zsh startup file. Open a new terminal or run the `source` command printed
by Socket to activate the aliases in your current shell.
