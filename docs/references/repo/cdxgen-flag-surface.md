# cdxgen flag surface (v11.2.7)

The `yargsConfig` object in
`packages/cli/src/commands/manifest/cmd-manifest-cdxgen.mts` re-declares
cdxgen's own argument parser so that Socket CLI can parse a cdxgen command line
before handing it off. That means our copy has to agree with upstream's copy,
flag for flag, or arguments get misread.

This file is the frozen `--help` output for the pinned version. It is the
evidence behind our config: when you need to know whether `--filter` is an
array or a string, the answer is here rather than in a browser tab.

## Why a snapshot instead of a link

A link tells you what upstream looks like _today_. Our parser has to match the
version we actually pin, so the useful reference is the output as of that pin.
Keeping it in the repo also means the diff shows up in review when someone
bumps the version.

## How to refresh it

Run the same command against the new version and replace the block below:

```bash
npx @cyclonedx/cdxgen@<new-version> --help
```

Then diff the two. Pay closest attention to flags that change _type_ — a flag
that moves between boolean, string, and array does not raise an error when our
config disagrees. It parses to the wrong shape silently, and the mistake
surfaces much later as a malformed SBOM.

Upstream sources for the pinned version:

- Parser config: https://github.com/CycloneDX/cdxgen/blob/v11.2.7/bin/cdxgen.js#L64
- `isSecureMode`: https://github.com/CycloneDX/cdxgen/blob/v11.2.7/lib/helpers/utils.js#L66

## Frozen output

```console
npx @cyclonedx/cdxgen@11.2.7 --help

Options:
  -o, --output                 Output file. Default bom.json                                       [default: "bom.json"]
  -t, --type                   Project type. Please refer to https://cyclonedx.github.io/cdxgen/#/PROJECT_TYPES for supp
                               orted languages/platforms.                                                        [array]
      --exclude-type           Project types to exclude. Please refer to https://cyclonedx.github.io/cdxgen/#/PROJECT_TY
                               PES for supported languages/platforms.
  -r, --recurse                Recurse mode suitable for mono-repos. Defaults to true. Pass --no-recurse to disable.
                                                                                               [boolean] [default: true]
  -p, --print                  Print the SBOM as a table with tree.                                            [boolean]
  -c, --resolve-class          Resolve class names for packages. jars only for now.                            [boolean]
      --deep                   Perform deep searches for components. Useful while scanning C/C++ apps, live OS and oci i
                               mages.                                                                          [boolean]
      --server-url             Dependency track url. Eg: https://deptrack.cyclonedx.io
      --skip-dt-tls-check      Skip TLS certificate check when calling Dependency-Track.      [boolean] [default: false]
      --api-key                Dependency track api key
      --project-group          Dependency track project group
      --project-name           Dependency track project name. Default use the directory name
      --project-version        Dependency track project version                                   [string] [default: ""]
      --project-id             Dependency track project id. Either provide the id or the project name and version togeth
                               er                                                                               [string]
      --parent-project-id      Dependency track parent project id                                               [string]
      --required-only          Include only the packages with required scope on the SBOM. Would set compositions.aggrega
                               te to incomplete unless --no-auto-compositions is passed.                       [boolean]
      --fail-on-error          Fail if any dependency extractor fails.                                         [boolean]
      --no-babel               Do not use babel to perform usage analysis for JavaScript/TypeScript projects.  [boolean]
      --generate-key-and-sign  Generate an RSA public/private key pair and then sign the generated SBOM using JSON Web S
                               ignatures.                                                                      [boolean]
      --server                 Run cdxgen as a server                                                          [boolean]
      --server-host            Listen address                                                     [default: "127.0.0.1"]
      --server-port            Listen port                                                             [default: "9090"]
      --install-deps           Install dependencies automatically for some projects. Defaults to true but disabled for c
                               ontainers and oci scans. Use --no-install-deps to disable this feature.
                                                                                               [boolean] [default: true]
      --validate               Validate the generated SBOM using json schema. Defaults to true. Pass --no-validate to di
                               sable.                                                          [boolean] [default: true]
      --evidence               Generate SBOM with evidence for supported languages.           [boolean] [default: false]
      --spec-version           CycloneDX Specification version to use. Defaults to 1.6
                                                                        [number] [choices: 1.4, 1.5, 1.6, 1.7] [default: 1.6]
      --filter                 Filter components containing this word in purl or component.properties.value. Multiple va
                               lues allowed.                                                                     [array]
      --only                   Include components only containing this word in purl. Useful to generate BOM with first p
                               arty components alone. Multiple values allowed.                                   [array]
      --author                 The person(s) who created the BOM. Set this value if you're intending the modify the BOM
                               and claim authorship.                               [array] [default: "OWASP Foundation"]
      --profile                BOM profile to use for generation. Default generic.
  [choices: "appsec", "research", "operational", "threat-modeling", "license-compliance", "generic", "machine-learning",
                                                       "ml", "deep-learning", "ml-deep", "ml-tiny"] [default: "generic"]
      --exclude                Additional glob pattern(s) to ignore                                              [array]
      --export-proto           Serialize and export BOM as protobuf binary.  [boolean] [default: false]
      --proto-bin-file         Path for the serialized protobuf binary.  [default: "bom.cdx"]
      --include-formulation    Generate formulation section with git metadata and build tools. Defaults to false.
                                                                                              [boolean] [default: false]
      --include-crypto         Include crypto libraries as components.                        [boolean] [default: false]
      --standard               The list of standards which may consist of regulations, industry or organizational-specif
                               ic standards, maturity models, best practices, or any other requirements which can be eva
                               luated against or attested to.
  [array] [choices: "asvs-5.0", "asvs-4.0.3", "bsimm-v13", "masvs-2.0.0", "nist_ssdf-1.1", "pcissc-secure-slc-1.1", "scv
                                                                                         s-1.0.0", "ssaf-DRAFT-2023-11"]
      --json-pretty            Pretty-print the generated BOM json.                           [boolean] [default: false]
      --min-confidence         Minimum confidence needed for the identity of a component from 0 - 1, where 1 is 100% con
                               fidence.                                                            [number] [default: 0]
      --technique              Analysis technique to use
  [array] [choices: "auto", "source-code-analysis", "binary-analysis", "manifest-analysis", "hash-comparison", "instrume
                                                                                                   ntation", "filename"]
      --auto-compositions      Automatically set compositions when the BOM was filtered. Defaults to true
                                                                                               [boolean] [default: true]
  -h, --help                   Show help                                                                       [boolean]
  -v, --version                Show version number                                                             [boolean]
```
