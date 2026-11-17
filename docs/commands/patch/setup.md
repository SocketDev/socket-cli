# `socket patch setup`

Configure patches to reapply after package installs. For npm projects, setup
prepends `socket patch apply --silent --ecosystems npm` to `postinstall`
scripts and can update nested `package.json` files.

```sh
socket patch setup --dry-run
socket patch setup
```

Use `--dry-run` to preview the changes or `--yes` to skip the confirmation
prompt. Run `socket patch setup --help` for all options.
