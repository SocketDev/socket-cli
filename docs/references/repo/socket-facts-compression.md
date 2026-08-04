# Why the compressed facts file is written as a sibling

`compressSocketFactsForUpload()` brotli-compresses each `.socket.facts.json`
before upload and writes the result to `.socket.facts.json.br` **next to the
original file**. Writing to a temp directory would be the obvious choice, and it
does not work. This note records why, so nobody "fixes" it back.

## The constraint

depscan's multipart ingest (`addStreamEntry`) rejects entries whose names
contain `..` traversal segments.

The SDK derives the multipart entry name with `path.relative(cwd, brPath)`. A
path under the OS temp directory relativizes into something like
`../../../var/folders/...`, which contains `..` and gets silently dropped into
`unmatchedFiles`. The upload appears to succeed while the compressed facts never
arrive.

Writing the `.br` beside its source keeps the relative path inside `cwd`, so the
entry name stays clean.

## The second benefit

Sibling-write also keeps the directory shape symmetric with the uncompressed
upload. depscan strips only the `.br` suffix at ingest, so
`<dir>/.socket.facts.json.br` and `<dir>/.socket.facts.json` resolve to the same
storage path. Compressing a scan does not move where its facts land.

## Why streaming on a worker thread

Brotli at its default quality (11) on a 60+MB facts file costs multiple seconds
of CPU. Doing that on the main thread would freeze the spinner, delay signal
handlers, and stall anything running concurrently. Streaming into a worker keeps
the event loop responsive for the whole compression.

## Concurrency

Two scans against the same source directory would race on the sibling `.br`.
They already race on `.socket.facts.json` itself, because coana writes it to a
single fixed path, so the sibling introduces no new hazard.

## Cleanup is the caller's job

The sibling files are real files in the user's tree. The caller must
`await cleanup()` once the upload finishes, successfully or not, which in
practice means a `finally` block. Skipping it leaves `.br` files scattered
beside the user's manifests.
