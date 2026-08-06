# Artifact hygiene

What ships is the packed tarball, not the source tree. Every gate that matters
runs against the bytes that will be published, because a published version is
immutable and unpublish is restricted.

## Validate the packed tarball as bytes

`scripts/fleet/check/pack-contents-are-clean.mts` runs `pnpm pack` and inspects
the real archive. It never trusts the `files:` field or the working tree as a
prediction of what npm will send.

- **Closed allowlist of entries.** Anything outside the `files` contract fails,
  including fleet and agent scaffolding, dotfiles, and logs.
- **Every entry is a regular file or a directory.** A symlink, hardlink, device
  node, or FIFO in a tarball is an extraction-time escape primitive.
- **No duplicate entry paths.** Which copy wins is extractor-defined, so a
  benign first entry can be shadowed by a hostile second.
- **No `..` path segment and no backslash** in any entry name.
- **Exec bit on every declared bin.** A `bin` / `directories.bin` target without
  user, group, and other execute ships a CLI that cannot run.
- **Every declared lifecycle script resolves inside the tarball.** The consumer
  runs `preinstall` / `install` / `postinstall` / `prepare` / `prepack` from the
  archive alone, so a repo-only target breaks every install.
- **Hash-pin binary assets.** Images and prebuilt blobs are compared against a
  blessed SHA-256, so a swapped binary fails the gate.

Derive the allowlist from the tree: a `readdir` over the module list, or the
`files` contract itself. A hand-maintained duplicate of the source layout rots
the first time a module is added.

## Scan the packed bytes, including what is compressed

`scripts/fleet/check/pack-bytes-have-no-private-refs.mts` extracts every
text-like entry and scans it with the same canonical matchers the source-level
scanners use: private and internal path shapes, fleet-denied domains, and
credential value shapes. A build step can bake a build machine's home directory,
an internal hostname, or a secret into `dist/` output that no source scan ever
sees.

- **Decompress before scanning.** A Brotli or gzip asset hides the same strings
  from a raw byte scan. Reassemble multi-part assets before decoding.
- **Assert the decoded length.** Comparing bytes written against the expected
  length catches a payload appended past the declared end.
- **Cap decompression** (32 MiB is the working ceiling) so a compression bomb
  fails the gate instead of wedging it.
- **Keep the patterns a named array with one unit test per pattern.** A single
  several-hundred-character regex is untestable and drifts silently.

## Publish integrity

- **The publishing job checks out nothing.** The job that holds the publish
  identity runs no repo code and no dependency code. It downloads the artifact
  the verify job produced, by artifact id, with a digest mismatch treated as a
  hard error, and publishes those exact bytes. The digest check closes the
  substitution gap between verify and publish.
- **Gate the tag before the build.** A strict stable-semver tag, a tag version
  equal to the manifest version, and a tag commit that is an ancestor of the
  default branch. A tag pointing off the default branch cannot release.
- **Smoke the artifact as a consumer.** Install the tarball into a throwaway
  directory with lifecycle scripts ignored, import the package, and run the
  installed `.bin` shim rather than the source entry. Assert the reported
  version equals the packed manifest version.
- **Build the runtime container image from the packed tarball,** so the image
  and the registry ship identical bytes and the artifact gate runs on every
  image build.

## Run the same gate everywhere

One script, several enforcement points: pull-request CI, the release gate, and
the container build. A validation that runs in only one of the three is a
validation the other two paths route around.
