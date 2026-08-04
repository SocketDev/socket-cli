# Reading a failed `bazel mod show_extension`

Socket CLI probes a Bazel workspace for Maven dependencies by running:

```bash
bazel mod show_extension @rules_jvm_external//:extensions.bzl%maven
```

That command exits non-zero in two situations that mean opposite things. Telling
them apart is the whole job of the classifier in
`packages/cli/src/commands/manifest/bazel/bazel-repo-discovery.mts`, and getting
it wrong is a security problem rather than a cosmetic one.

## The two failures

**The extension is not in the dependency graph.** This is the common case: any
bzlmod repo that does not use `rules_jvm_external` has no Maven at all. Bazel's
`ModCommand` resolves the extension argument up front through
`ExtensionArg.resolveToExtensionId`, which throws `InvalidArgumentException` and
exits before evaluating any Starlark.

This is not a failure to analyze. It is a positive, authoritative answer:
there is no Maven extension here. It maps to `not-defined`, and the workspace
cleanly contributes no Maven.

**The module graph fails to evaluate.** A Starlark error, an unbound name (a
`MODULE.bazel` referencing `PYTHON_VERSION` or `pip` before defining it), a
syntax error, or the bazel binary being missing or failing to spawn, which is
normalized to exit code -1.

Here we learn nothing about whether a Maven extension exists. It maps to
`indeterminate`, and a run containing one can never be reported complete.

## Why conflating them is dangerous

Treating an evaluation failure as `not-defined` would report "this workspace has
no Maven dependencies" when the truth is "we could not tell." For a tool whose
output feeds dependency scanning, silently converting an unknown into a clean
negative hides real dependencies from the scan. The asymmetry is deliberate:
`indeterminate` is noisy and safe, a wrong `not-defined` is quiet and unsafe.

## How the classification works, and its weakness

Classification is by **stderr shape**, using two regex families: one for
argument-resolution errors and one for evaluation failures.

The known-good anchor is Bazel's verified real wording for the first family.
Running `bazel mod show_extension` against a bzlmod repo without
`rules_jvm_external` produces:

```text
No module with the apparent repo name @rules_jvm_external exists in the dependency graph
```

The weakness is that exact wording differs across Bazel versions. The regex
families are intentionally broad to absorb that, which means they are a
heuristic rather than a contract. When touching them, confirm against live
`bazel mod show_extension` output from the Bazel versions in play rather than
reasoning about the patterns alone.
