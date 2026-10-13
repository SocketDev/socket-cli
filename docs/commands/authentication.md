# Authentication

## `socket login`

Authenticate with Socket. The default flow opens a browser for device approval
and stores OAuth credentials in the operating system credential store. Local
CLI configuration keeps session metadata.

```sh
socket login
```

Use `--no-device` to enter an API token in an interactive terminal. Set
`SOCKET_CLI_API_TOKEN` for non-interactive use. `--api-base-url` and
`--api-proxy` select an API endpoint and proxy.

## `socket logout`

Remove saved OAuth and API token credentials, plus saved API endpoint and proxy
settings.

```sh
socket logout
```

Settings overridden by flags or environment variables cannot be removed from
the saved file by this command.

## `socket whoami`

Show whether the CLI can resolve a Socket credential and where it came from.
Use `--json` for a machine-readable status. The command shows only a token
prefix, not the full token.

```sh
socket whoami
```
