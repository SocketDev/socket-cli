# Socket CLI

[![Socket Badge](https://socket.dev/api/badge/npm/package/socket)](https://socket.dev/npm/package/socket)
[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)

> CLI tool for [Socket.dev](https://socket.dev/)

## Usage

```bash
npm install -g socket
socket --help
```

## Commands

- `socket npm [args...]` and `socket npx [args...]` - Wraps `npm` and `npx` to
  integrate Socket and preempt installation of alerted packages using the
  builtin resolution of `npm` to precisely determine package installations.

- `socket optimize` - Optimize dependencies with
  [`@socketregistry`](https://github.com/SocketDev/socket-registry) overrides!
  _(👀 [our blog post](https://socket.dev/blog/introducing-socket-optimize))_

  - `--pin` - Pin overrides to their latest version.
  - `--prod` - Add overrides for only production dependencies.

- `socket cdxgen [command]` - Call out to
  [cdxgen](https://cyclonedx.github.io/cdxgen/#/?id=getting-started). See
  [their documentation](https://cyclonedx.github.io/cdxgen/#/CLI?id=getting-help)
  for commands.

## Aliases

All aliases support the flags and arguments of the commands they alias.

- `socket ci` - alias for `socket report create --view --strict` which creates a
  report and quits with an exit code if the result is unhealthy. Use like eg.
  `socket ci .` for a report for the current folder

## Flags

### Command specific flags

- `--view` - when set on `socket report create` the command will immediately do
  a `socket report view` style view of the created report, waiting for the
  server to complete it

### Output flags

- `--json` - outputs result as json which you can then pipe into
  [`jq`](https://stedolan.github.io/jq/) and other tools
- `--markdown` - outputs result as markdown which you can then copy into an
  issue, PR or even chat

## Strictness flags

- `--all` - by default only `high` and `critical` issues are included, by
  setting this flag all issues will be included
- `--strict` - when set, exits with an error code if report result is deemed
  unhealthy

### Other flags

- `--dry-run` - like all CLI tools that perform an action should have, we have a
  dry run flag. Eg. `socket report create` supports running the command without
  actually uploading anything
- `--debug` - outputs additional debug output. Great for debugging, geeks and us
  who develop. Hopefully you will never _need_ it, but it can still be fun,
  right?
- `--help` - prints the help for the current command. All CLI tools should have
  this flag
- `--version` - prints the version of the tool. All CLI tools should have this
  flag

## Configuration files

The CLI reads and uses data from a
[`socket.yml` file](https://docs.socket.dev/docs/socket-yml) in the folder you
run it in. It supports the version 2 of the `socket.yml` file format and makes
use of the `projectIgnorePaths` to excludes files when creating a report.

## Environment variables

- `SOCKET_CLI_API_TOKEN` - if set, this will be used as the API-key

## Contributing

### Setup

To run dev locally you can run these steps

```
npm install
npm run build:dist
npm exec socket
```

That should invoke it from local sources. If you make changes you run
`build:dist` again.

### Environment variables for development

- `SOCKET_CLI_API_BASE_URL` - if set, this will be the base for all
  API-calls. Defaults to `https://api.socket.dev/v0/`
- `SOCKET_CLI_API_PROXY` - if set to something like
  [`http://127.0.0.1:9090`](https://docs.proxyman.io/troubleshooting/couldnt-see-any-requests-from-3rd-party-network-libraries),
  then all request will be proxied through that proxy

## Similar projects

- [`@socketsecurity/sdk`](https://github.com/SocketDev/socket-sdk-js) - the SDK
  used in this CLI

## See also

- [Announcement blog post](https://socket.dev/blog/announcing-socket-cli-preview)
- [Socket API Reference](https://docs.socket.dev/reference) - the API used in
  this CLI
- [Socket GitHub App](https://github.com/apps/socket-security) - the
  plug-and-play GitHub App
