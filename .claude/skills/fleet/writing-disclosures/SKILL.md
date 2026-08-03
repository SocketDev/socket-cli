---
name: writing-disclosures
description: Write or review a dual-use DISCLOSURE file; npm Trust & Safety reads it, so every claim must be verifiable.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
model: claude-sonnet-4-6
---

# writing-disclosures

Write the `DISCLOSURE` file for a package that declares
`contentPolicy.class: "dual-use"` (npm policy:
https://docs.npmjs.com/policies/dual-use). The policy asks for free-form
text that describes two things: the dual-use functionality, and its
intended legitimate use. npm's Trust & Safety team reads this file when
they review the package, and the declaration can never be removed once a
version ships with it — so every sentence must be true, provable, and
plainly written.

## The one rule

**No sentence without a receipt.** Before writing a claim, find the code
that proves it — a `bin` entry, a dependency, a network call site, a build
config line — and keep the receipt next to the draft. If no receipt exists,
the sentence does not go in. The incident this rule comes from: a member's
first draft named three executables while the manifest shipped five, said the
packages "transmit only scan data" (one build variant bundles a Sentry SDK
and reports crashes to Sentry), and asserted "no persistence capability" —
an absolute nobody can prove.

## Process

1. Open the declaring manifest. List every `bin` key, every dependency
   that talks to the network (http clients, telemetry SDKs, anything
   Sentry-like), and the `repository` URL.
2. Grep the source for what the tool actually does: what it wraps or
   shims, what files it reads, every remote endpoint it contacts, and
   what data each request carries. Variant builds count — if a build
   toggle injects a dependency (an INLINED_* flag, an instrumentation
   entry), the shipped artifact's behavior is what must be disclosed.
3. Write four parts, in plain full sentences a junior developer can read
   without a dictionary:
   - What the package is, in one short paragraph (and, for multi-variant
     roots, what each published name is).
   - What it does that can look like malware — name every executable,
     every wrap/shim, every file-read behavior, every install-blocking
     behavior. Understating this is as false as overstating it.
   - What it sends over the network — every destination, what data, and
     which variant sends it. Telemetry is transmission.
   - The intended legitimate use, ending with the public source URL.
4. Delete every unprovable absolute ("no persistence capability", "never
   collects data") and every marketing word. Describe what the code does,
   not what it is not.
5. Run the gates and fix what they name:

   ```bash
   node scripts/fleet/check/dual-use-declarations-are-complete.mts
   node scripts/fleet/check/disclosure-content-is-grounded.mts
   ```

## Remember

- The declaration is one-way: once a version publishes with
  `contentPolicy` + `DISCLOSURE`, no later version may drop them.
- Dual-use packages must publish through 2FA-enforced paths (trusted
  publishing, staged publishing) — the fleet's staged flow already is one.
- `DISCLOSURE` must ride the tarball: keep it in the manifest's `files`
  allowlist.
