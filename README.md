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
socket report create package.json
```

## Commands

* `info <package@version>` - looks up issues for a package
* `report create` - creates a report

## Environment variables

* `SOCKET_SECURITY_API_KEY` - if set, this will be used as the API-key

### Environment variables for development

* `SOCKET_SECURITY_API_BASE_URL` - if set, this will be the base for all API-calls. Defaults to `https://api.socket.dev/v0/`
* `SOCKET_SECURITY_API_PROXY` - if set to something like [`http://127.0.0.1:9090`](https://docs.proxyman.io/troubleshooting/couldnt-see-any-requests-from-3rd-party-network-libraries), then all request will be proxied through that proxy

## See also

* [`@socketsecurity/sdk`]('https://github.com/SocketDev/socket-sdk-js") - the SDK used in this CLI
* [Socket API Reference](https://docs.socket.dev/reference) - the API used in this CLI
* [Socket GitHub App](https://github.com/apps/socket-security) - the plug-and-play GitHub App
