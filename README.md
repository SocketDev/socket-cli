# Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)

> CLI tool for [Socket.dev]

## Usage

```bash
npm install -g socket
socket --help
```

## Commands

- `socket npm [args...]` and `socket npx [args...]` - Wraps `npm` and `npx` to
  integrate [Socket.dev] and preempt installation of alerted packages using the
  builtin resolution of `npm` to precisely determine package installations

- `socket optimize` - Optimize dependencies with
  [`@socketregistry`](https://github.com/SocketDev/socket-registry) overrides
  _(👀 [our blog post](https://socket.dev/blog/introducing-socket-optimize))_

  - `--pin` - Pin overrides to their latest version
  - `--prod` - Add overrides for only production dependencies

- `socket cdxgen [command]` - Call out to
  [cdxgen](https://cyclonedx.github.io/cdxgen/#/?id=getting-started). See
  [their documentation](https://cyclonedx.github.io/cdxgen/#/CLI?id=getting-help)
  for commands.

## Aliases

All aliases support the flags and arguments of the commands they alias.

- `socket ci` - alias for `socket scan create --report` which creates a report for the current directory and quits with an exit code if the result is unhealthy

## Flags

### Output flags

- `--json` - Outputs result as JSON which can be piped into [`jq`](https://stedolan.github.io/jq/) and other tools
- `--markdown` - Outputs result as Markdown which can be copied into issues, pull requests, or chats

### Other flags

- `--dry-run` - Run a command without uploading anything
- `--debug` - Output additional debug
- `--help` - Prints help documentation
- `--max-old-space-size` - Set Node's V8 [`--max-old-space-size`](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib) option
- `--max-semi-space-size` - Set Node's V8 [`--max-semi-space-size`](https://nodejs.org/api/cli.html#--max-semi-space-sizesize-in-mib) option
- `--version` - Prints the Socket CLI version

## Configuration files

Socket CLI reads and uses data from a
[`socket.yml` file](https://docs.socket.dev/docs/socket-yml) in the folder you
run it in. It supports the version 2 of the `socket.yml` file format and makes
use of the `projectIgnorePaths` to excludes files when creating a report.

## Environment variables

- `SOCKET_CLI_API_TOKEN` - Set the Socket API token
- `SOCKET_CLI_CONFIG` - A JSON stringified Socket configuration object
- `SOCKET_CLI_GITHUB_API_URL` - Change the base URL for GitHub REST API calls
- `SOCKET_CLI_GIT_USER_EMAIL` - The git config `user.email` used by Socket CLI<br>
  *Defaults:* `github-actions[bot]@users.noreply.github.com`<br>
- `SOCKET_CLI_GIT_USER_NAME` - The git config `user.name` used by Socket CLI<br>
  *Defaults:* `github-actions[bot]`<br>
- `SOCKET_CLI_GITHUB_TOKEN` - A classic or fine-grained [GitHub personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) with the "repo" scope or read/write permissions set for "Contents" and "Pull Request"<br>
  *Aliases:* `GITHUB_TOKEN`<br>
- `SOCKET_CLI_NO_API_TOKEN` - Make the default API token `undefined`
- `SOCKET_CLI_NPM_PATH` - The absolute location of the npm directory
- `SOCKET_CLI_ORG_SLUG` - Specify the Socket organization slug<br><br>
- `SOCKET_CLI_ACCEPT_RISKS` - Accept risks of a Socket wrapped npm/npx run
- `SOCKET_CLI_VIEW_ALL_RISKS` - View all risks of a Socket wrapped npm/npx run

## Contributing

### Setup

To run locally execute the following commands:

```
npm install
npm run build
npm exec socket
```

### Environment variables for development

- `SOCKET_CLI_API_BASE_URL` - Change the base URL for Socket API calls<br>
  *Defaults:* The "apiBaseUrl" value of socket/settings local app data if present, else `https://api.socket.dev/v0/`<br>
- `SOCKET_CLI_API_PROXY` - Set the proxy Socket API requests are routed through, e.g. if set to<br>
  [`http://127.0.0.1:9090`](https://docs.proxyman.io/troubleshooting/couldnt-see-any-requests-from-3rd-party-network-libraries), then all request are passed through that proxy<br>
  *Aliases:* `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, and `http_proxy`<br>
- `SOCKET_CLI_API_TIMEOUT` - Set the timeout in milliseconds for Socket API requests
- `SOCKET_CLI_DEBUG` - Enable debug logging in Socket CLI
- `DEBUG` - Enable debug logging based on the [`debug`](https://socket.dev/npm/package/debug) package

## See also

- [Announcement blog post](https://socket.dev/blog/announcing-socket-cli-preview)
- [Socket API Reference](https://docs.socket.dev/reference) - The API used by Socket CLI
- [Socket GitHub App](https://github.com/apps/socket-security) - The plug-and-play GitHub App
- [`@socketsecurity/sdk`](https://github.com/SocketDev/socket-sdk-js) - The SDK used by Socket CLI

[Socket.dev]: https://socket.dev/
