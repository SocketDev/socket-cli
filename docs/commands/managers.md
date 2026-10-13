# Package manager commands

These commands pass package-manager arguments through Socket Firewall. Firewall
checks packages before installation.

| Command          | Runs                     | Example                            |
| ---------------- | ------------------------ | ---------------------------------- |
| `socket bundler` | Bundler                  | `socket bundler install`           |
| `socket cargo`   | Cargo                    | `socket cargo add serde`           |
| `socket gem`     | RubyGems                 | `socket gem install rake`          |
| `socket go`      | Go                       | `socket go get example.com/module` |
| `socket npm`     | npm                      | `socket npm install lodash`        |
| `socket npx`     | `npx`                    | `socket npx cowsay`                |
| `socket nuget`   | NuGet                    | `socket nuget restore`             |
| `socket pip`     | pip                      | `socket pip install requests`      |
| `socket pnpm`    | pnpm                     | `socket pnpm add lodash`           |
| `socket uv`      | uv                       | `socket uv add requests`           |
| `socket yarn`    | Yarn                     | `socket yarn add lodash`           |
| `socket sfw`     | Socket Firewall directly | `socket sfw npm install lodash`    |

Use `socket sfw ca init`, `socket sfw ca path`, and `socket sfw ca trust` to
manage the local Firewall certificate authority. `init --force` rotates the
managed CA and retains a backup. `trust` installs the certificate when the
terminal has administrator privileges; otherwise it prints the required
system commands.

The root alias `firewall` routes to `sfw`. The hidden alias `pip3` routes to
`pip`.

## Commands that bypass Firewall

`raw-npm` runs npm and `raw-npx` runs `npx` without Socket install gating. Use
these commands only when you intend to bypass the wrapper.

```sh
socket raw-npm install --global cowsay
socket raw-npx cowsay
```

The npm and pnpm `exec` wrapper can be enabled with `socket wrapper on`. The raw
commands bypass that wrapper for one invocation.
