# Organization dependency inventory

`socket organization dependencies` lists dependency records already known to
the authenticated organization. It does not scan the current directory. This
command does not accept a package name or an organization slug.

## Access

Run `socket login` to save a Socket API token, or set the supported
`SOCKET_CLI_API_TOKEN` environment variable. The inventory available to the
command depends on the credential you use. The command requires API access.

## List dependencies

Run the command without options to request the first 50 dependency artifacts:

```sh
socket organization dependencies
```

Use `--limit` to set the number of dependency artifacts requested. The API
accepts values from 1 to 100. The default is 50. Use `--offset` to skip that
many dependency artifacts; the default is 0.
For example, request results in batches of 20:

```sh
socket organization dependencies --limit 20 --offset 0
socket organization dependencies --limit 20 --offset 20
socket organization dependencies --limit 20 --offset 40
```

Check the output's “Is there more data after this?” value. Continue with the
next offset until it says `no`. The limit applies to dependency artifacts. An
artifact can have more than one repository link, so the displayed row count
can be greater than the limit. Each invocation makes one request; the command
does not paginate automatically.

## Choose an output format

The default output and `--markdown` display a text table with ecosystem,
namespace, name, version, repository, branch, and direct dependency columns.
The output also shows the requested offset and limit and whether more data is
available.

Use `--json` to write the result envelope to a file:

```sh
socket organization dependencies --json > dependencies.json
```

On success, the JSON envelope contains `ok` and `data`. Read dependency rows
from `data.rows`; `data` also includes `end`, `limit`, and `offset`. The
`--json` and `--markdown` options cannot be used together.

## Help and dry run

Use `--help` to see the available options:

```sh
socket organization dependencies --help
```

A dry run does not retrieve inventory. It only reports what the command would
request. On the 2.x prerelease, dry run requires authentication and reports the
selected limit and offset. On 1.x, it exits before making a request and prints
a generic dry-run message.
