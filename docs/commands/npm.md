# `socket npm`

Run npm through Socket's package security checks.

```sh
socket npm install
socket npm exec cowsay
```

`--help` shows the wrapper help. `--dry-run` exits before running npm. The
wrapper filters out Socket flags but forwards `--json` to npm.

The wrapper can use Socket's default public API token. A custom token needs
the `packages:list` permission.

Run `socket wrapper on` to add both `npm` and `npx` aliases to a supported Bash
or Zsh startup file. Open a new terminal or run the `source` command printed
by Socket to activate the aliases in your current shell.
