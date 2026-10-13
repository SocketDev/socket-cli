# MCP server

## `socket mcp`

Run the Socket Model Context Protocol server. Stdio mode is the default and
uses the local Socket API credential.

```sh
socket login
socket mcp
```

Configure an MCP client to launch `socket` with `mcp` as its argument. The
server exposes tools for package scoring, organization security data, and
published package files.

Use `--http` to run Streamable HTTP mode. HTTP mode supports a single-user API
token or OAuth introspection. Set the corresponding `--oauth-*` options or
`SOCKET_OAUTH_*` environment variables for OAuth. The default HTTP port is
3000; `--port` changes it.
