# Configuration

## `socket config`

Use these subcommands to read or change supported local CLI settings:

| Command                           | Purpose                                                    | Example                                    |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| `socket config auto <KEY>`        | Discover a setting and optionally save it after prompting. | `socket config auto defaultOrg`            |
| `socket config get <KEY>`         | Read one setting.                                          | `socket config get defaultOrg`             |
| `socket config list`              | List settings.                                             | `socket config list`                       |
| `socket config set <KEY> <VALUE>` | Save a setting.                                            | `socket config set defaultOrg example-org` |
| `socket config unset <KEY>`       | Remove a setting.                                          | `socket config unset defaultOrg`           |

The config file is local to the current user. `config list --full`
prints full tokens in plaintext; use it only when you need to inspect them.

## `socket json`

Print the effective `socket.json` for the current directory or a target
directory:

```sh
socket json ./project
```

This command reads configuration and prints it. It does not edit the file.

## Shell completion

`install` and `uninstall` manage shell completion only. They do not install or
remove the CLI program.

```sh
socket install completion
socket uninstall completion
```

The completion subcommands install and remove bash completion in `~/.bashrc`.

## `socket wrapper`

Enable or disable aliases in supported shell configuration files. When enabled,
npm and pnpm `exec` commands route through Socket Firewall.

```sh
socket wrapper on
socket wrapper off
```

Use `socket raw-npm` or `socket raw-npx` to bypass this wrapper for one command.
