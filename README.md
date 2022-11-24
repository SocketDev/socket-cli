# Socket CLI

[![npm version](https://img.shields.io/npm/v/@socketsecurity/cli.svg?style=flat)](https://www.npmjs.com/package/@socketsecurity/cli)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg)](https://github.com/SocketDev/eslint-config)
[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)

CLI tool for [Socket.dev](https://socket.dev/)

## Usage

```bash
npm install -g @socketsecurity/cli
```

```bash
socket --help
socket info webtorrent@1.9.1
socket report create package.json --view
socket report view QXU8PmK7LfH608RAwfIKdbcHgwEd_ZeWJ9QEGv05FJUQ
```

## Commands

* `socket info <package@version>` - looks up issues for a package
* `socket report create <path(s)-to-folder-or-file>` - uploads the specified `package.json` and/or `package-lock.json` to create a report on [socket.dev](https://socket.dev/). If only one of a `package.json`/`package-lock.json` has been specified, the other will be automatically found and uploaded if it exists
* `socket report view <report-id>` - looks up issues and scores from a report

## Flags

### Command specific flags

* `--view` - when set on `socket report create` the command will immediately do a `socket report view` style view of the created report, waiting for the server to complete it

### Output flags

* `--json` - outputs result as json which you can then pipe into [`jq`](https://stedolan.github.io/jq/) and other tools
* `--markdown` - outputs result as markdown which you can then copy into an issue, PR or even chat

## Strictness flags

* `--all` - by default only `high` and `critical` issues are included, by setting this flag all issues will be included
* `--strict` - when set, exits with an error code if any issues were found

### Other flags

* `--dry-run` - like all CLI tools that perform an action should have, we have a dry run flag. Eg. `socket report create` supports running the command without actually uploading anything
* `--debug` - outputs additional debug output. Great for debugging, geeks and us who develop. Hopefully you will never _need_ it, but it can still be fun, right?
* `--help` - prints the help for the current command. All CLI tools should have this flag
* `--version` - prints the version of the tool. All CLI tools should have this flag

## Environment variables

* `SOCKET_SECURITY_API_KEY` - if set, this will be used as the API-key

## Contributing

### Environment variables for development

* `SOCKET_SECURITY_API_BASE_URL` - if set, this will be the base for all API-calls. Defaults to `https://api.socket.dev/v0/`
* `SOCKET_SECURITY_API_PROXY` - if set to something like [`http://127.0.0.1:9090`](https://docs.proxyman.io/troubleshooting/couldnt-see-any-requests-from-3rd-party-network-libraries), then all request will be proxied through that proxy

## Similar projects

* [`@socketsecurity/sdk`](https://github.com/SocketDev/socket-sdk-js) - the SDK used in this CLI

## See also

* [Announcement blog post](https://socket.dev/blog/announcing-socket-cli-preview)
* [Socket API Reference](https://docs.socket.dev/reference) - the API used in this CLI
* [Socket GitHub App](https://github.com/apps/socket-security) - the plug-and-play GitHub App
