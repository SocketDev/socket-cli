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

* `socket report create <path(s)-to-folder-or-file>` - creates a report on [socket.dev](https://socket.dev/)

  Uploads the specified `package.json` and lock files and, if any folder is specified, the ones found in there. Also includes the complementary `package.json` and lock file to any specified. Currently `package-lock.json` and `yarn.lock` are supported.

  Supports globbing such as `**/package.json`.

  Ignores any file specified in your project's `.gitignore`, the `projectIgnorePaths` in your project's [`socket.yml`](https://docs.socket.dev/docs/socket-yml) and on top of that has a sensible set of [default ignores](https://www.npmjs.com/package/ignore-by-default)

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

## Configuration files

The CLI reads and uses data from a [`socket.yml` file](https://docs.socket.dev/docs/socket-yml) in the folder you run it in. It supports the version 2 of the `socket.yml` file format and makes use of the `projectIgnorePaths` to excludes files when creating a report.

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
