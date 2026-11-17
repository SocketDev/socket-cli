# Build settings for `--dynamic-sbom-inference`

How to write the `socket.json` settings that `--dynamic-sbom-inference` reads,
by hand or with an agent. `socket manifest setup --dynamic-sbom-inference`
asks the same questions interactively and writes the same files.

## What the scan does

1. Finds every file that looks like a build: `pom.xml` and its variants
   (`*-*.pom.xml`, `pom`), `.sln`, `.slnx`, `.csproj`, `.fsproj`, `.vbproj`,
   `build.gradle(.kts)`, `settings.gradle(.kts)`, `build.sbt`. It honours
   `.gitignore`, `socket.yml` ignores and `--exclude-paths`.
2. Runs each build's own tool (Maven, Gradle, sbt, the .NET SDK) to resolve
   its dependencies, unless another build already loads it. A Maven reactor
   builds its modules, including ones outside its directory such as
   `<module>../core</module>`; a Gradle or sbt build builds its subprojects.
3. Fails if any build it runs fails, naming the build.

Settings tell the build tools how to run each build, and which builds not to
run.

## Prefer builds Socket can load

Socket learns what a build includes only by letting its tool load it: Maven
profiles, Gradle settings scripts and sbt definitions are code. When a build
loads:

- each module is built once, inside the build that owns it;
- skipping the build skips exactly it and its modules, wherever they are, and
  leaves the builds next to and beneath it alone.

So fix a build that fails to load (usually a JDK, build tool or option) before
reaching for a skip.

## Where settings live

- Any directory may hold a `socket.json`. Its settings apply to that directory
  and everything beneath it.
- Every `socket.json` from the filesystem root down to a build's directory
  applies; for each field the nearest one wins. `null` clears an inherited
  value.
- `defaults.manifest.builds` in a directory's `socket.json` holds settings for
  one build of that directory, keyed by its build file name. They apply after
  all directory settings, to that build alone.

```json
{
  "version": 1,
  "defaults": {
    "manifest": {
      "maven": { "javaHome": "$JAVA17_HOME" },
      "builds": {
        "pom.xml": { "disabled": true },
        "tools-cli.pom.xml": { "mavenOpts": "-Pcli" }
      }
    }
  }
}
```

A Gradle or sbt build is keyed by any one of its build files that exists
(`settings.gradle`, `build.gradle.kts`, `build.sbt`, ...); two entries for the
same build are an error.

## Fields

Under `defaults.manifest.maven`, `.gradle`, `.sbt` or `.dotnet`, or inside a
`builds` entry:

| Field | Meaning |
|---|---|
| `bin` | Build tool command. Relative paths are relative to the build's directory. Defaults to the project's wrapper (`mvnw`, `gradlew`) if present, else `mvn`, `gradle`, `sbt`, `dotnet`. |
| `javaHome` | JDK for Maven, Gradle and sbt. `$VAR` and `${VAR}` expand from the environment. |
| `mavenOpts`, `gradleOpts`, `sbtOpts`, `dotnetOpts` | Arguments passed to the build tool, for example profiles or `-p:Configuration=Release`. Maven's `-f`/`--file` is ignored: each POM is built by its own file. |
| `includeConfigs`, `excludeConfigs` | Comma-separated globs over Maven scopes, Gradle and sbt configurations, or .NET target frameworks. |
| `ignoreUnresolved` | `true` warns about dependencies that don't resolve instead of failing. |
| `disabled` | `true` skips builds; see below. |
| `facts` | Gradle and sbt: `false` skips the build. |
| `verbose` | `true` streams the build tool's output. |
| `reachability.build` | `"compile"` builds the project before the analysis, and a failed build fails the scan; `"none"` or unset analyses it unbuilt. |
| `reachability.javaHome` | Maven, Gradle and sbt: the JDK the analysis takes the program to run on, passed to Coana as written. |
| `reachability.runtimeVersion` | .NET: the runtime a framework-dependent build's analysis starts on. `major.minor` takes its latest installed patch; `major.minor.patch[-prerelease]` takes exactly that runtime. |

Only reachability scans read the `reachability` fields, each cascading on its
own, and only for the build tools they run. An invalid value or a field the
build tool does not take fails the scan.

## Skipping builds

| To skip | Set | Effect |
|---|---|---|
| One build and what it loads | `builds["<build file>"].disabled: true` in its directory | Socket still loads the build, resolving nothing, to find its modules. If it can't load it, the scan fails. |
| A directory and everything beneath it | `defaults.manifest.<tool>.disabled: true` in that directory | Nothing is loaded. A nearer `socket.json` with `disabled: false` turns builds beneath it back on. |

Don't use `--exclude-paths` to skip builds: it also removes those files from
the scan and from reachability analysis.

Socket can't skip a module of a build that runs: the build resolves its
modules itself. Settings for such a module are ignored, with a warning.

## Procedure for an agent

1. Run `socket manifest dynamic-sbom-inference <dir> --json` from the
   repository root. It runs every build and lists each with a status:

   | Status | Meaning |
   |---|---|
   | `generated` | Built. |
   | `empty` | Built; nothing to resolve. |
   | `skippedCovered` | Built as part of another build. |
   | `skippedDisabled` | Skipped by a setting, or loaded by a skipped build. |
   | `failed` | Its build tool failed; the output above it says why. |
   | `aborted` | Not run because a build in or above its directory failed. |

2. For each `failed` build, read the build tool's error and fix the cause in
   the nearest fitting `socket.json`: `javaHome` for a wrong JDK, `bin` for a
   missing tool, `<tool>Opts` for missing profiles or properties.
3. Skip a build only when it is not meant to be built (a test fixture, a
   template, an abandoned project), using the table above. Prefer
   `builds["<file>"].disabled` when the build loads; use the directory form
   only when it doesn't.
4. Repeat until no build is `failed` or `aborted`.
5. Commit the `socket.json` files.

## Example

```
repo/
  pom.xml               reactor with modules api, web
  codegen/
    pom.xml             not shipped: skip it
    codegen-cli.pom.xml shipped
  legacy/
    pom.xml             doesn't load any more, with modules old-core, old-ui
    tool/pom.xml        separate build, shipped
```

`codegen/socket.json` skips one of two builds in the directory:

```json
{ "version": 1, "defaults": { "manifest": { "builds": { "pom.xml": { "disabled": true } } } } }
```

`legacy/pom.xml` doesn't load, so `legacy/socket.json` skips the directory:

```json
{ "version": 1, "defaults": { "manifest": { "maven": { "disabled": true } } } }
```

and `legacy/tool/socket.json` turns the build beneath it back on:

```json
{ "version": 1, "defaults": { "manifest": { "maven": { "disabled": false } } } }
```
