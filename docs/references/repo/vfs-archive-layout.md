# VFS archive layout

The SEA binary carries its tooling inside a compressed archive that binject
embeds as a virtual filesystem. Two archives get built and then combined, and
the directory shapes below are what the extraction code at runtime expects to
find. Getting a path wrong here does not fail the build; it fails much later
when the CLI tries to run a tool that is not where it looked.

Tool versions and which manager owns each tool live in
`packages/cli/bundle-tools.json`. That file is the source of truth. The trees
below show shape, not versions, so they do not go stale when a pin moves.

## Which tools come from where

`collectNpmToolPins()` selects the npm-managed entries, so the split below
follows whatever that function reads rather than a hand-kept list.

| Source | Tools |
| --- | --- |
| npm, installed with full dependency trees | `@coana-tech/cli`, `@cyclonedx/cdxgen`, `synp` |
| pip | `socketsecurity` |
| GitHub release assets | `opengrep`, `python`, `sfw`, `socket-patch`, `trivy`, `trufflehog` |
| GitHub release archive | `socket-basics` |

## The npm-packages archive

`downloadNpmPackages()` installs each npm tool with Arborist into a scratch
directory, then tars the whole `node_modules/` tree. Dependencies come along,
which is why this is an install rather than a plain download.

```text
<targetDir>/
└── node_modules/
    ├── @coana-tech/cli/
    │   ├── bin/coana
    │   ├── package.json
    │   └── node_modules/    # its own dependencies
    ├── @cyclonedx/cdxgen/
    │   ├── bin/cdxgen
    │   ├── package.json
    │   └── node_modules/    # its own dependencies
    └── synp/
        ├── bin/synp
        ├── package.json
        └── node_modules/    # its own dependencies
```

## The combined archive

`combineVfsArchives()` merges the npm archive with the platform's external-tool
archive into the single tar.gz that binject embeds. The binaries sit at the
root; only the npm packages keep a nested tree.

```text
./node_modules/       # the npm tree shown above
├── @coana-tech/cli/
├── @cyclonedx/cdxgen/
└── synp/
./python/             # Python runtime, a full directory rather than one binary
./opengrep            # OpenGrep binary
./socket-patch        # Socket Patch binary (Rust, v2.0.0+)
./trivy               # Trivy binary
./trufflehog          # TruffleHog binary
```

## Python is a directory, not a binary

Every other external tool is a single executable that can be moved on its own.
Python cannot: `python-build-standalone` ships a complete, self-contained
installation (~19 MB compressed) that needs its stdlib and headers present to
run at all. So the whole `python/` directory goes into the VFS for socket-basics
to use, rather than one extracted binary.

The internal shape differs by platform, which is why the extraction code
branches on Windows.

```text
Unix                                Windows
python/                             python/
├── bin/       # executable         ├── python.exe   # executable at root
├── lib/       # stdlib             ├── DLLs/        # DLLs and extensions
├── include/   # C headers          ├── Lib/         # stdlib
└── share/     # docs               ├── libs/        # import libraries
                                    └── include/     # C headers
```

The practical consequence is the executable path: `bin/python` on Unix,
`python.exe` at the root on Windows.
