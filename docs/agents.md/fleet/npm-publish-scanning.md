# npm publish-time scanning and review holds

Since 2026-07-28, npm scans every publish before it goes fully live ([changelog](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata)). Three outcomes: published normally, **held for manual review** on suspicious-but-inconclusive findings, or blocked as malware. Publishes also gain a scan delay, typically ~5 minutes, 15+ at peak or for large packages, during which `npm dist-tag` works but `npm deprecate` and `npm unpublish` are refused.

## The split-brain state a hold produces

A HELD package is live on the registry and invisible on the website at the same time: dist-tags resolve, the tarball downloads, `npm install` works, while `https://www.npmjs.com/package/<name>` answers 403. A human browsing npm concludes "not published"; an agent that only checks one side chases phantom causes. This cost a real diagnosis session on `@socketsecurity/odai@0.1.0` (2026-07-31), where the missing page and missing provenance badge were both mis-attributed, first to repo privacy, then to a broken publish setup.

**The rule: judge publish state from BOTH surfaces.** Registry (`npm view <pkg> dist-tags` + a tarball probe) answers "installable?"; the website page answers "visible?". Registry-yes + page-withheld is a review hold, not a failed publish.

**The page half is NOT scriptable anonymously.** npmjs.com bot-filters non-browser clients: a curl of a definitely-visible package (`@socketsecurity/lib`, probed 2026-07-31) answers the SAME 403 a held page would, browser user-agent or not - so a scripted probe can never distinguish "held" from "healthy", in either direction. A check built on that probe was added and retired the same day. Verify page state in a real browser, either the operator's or the sanctioned browser session, and treat any scripted 403 from npmjs.com as "no evidence", never as a verdict.

## What clears a hold, what prevents one

- Clears: npm's manual review completing on its own, or a support ticket from the org account naming the package and version.
- Prevents: **dual-use metadata**. Packages with security capabilities, which describes most of Socket's fleet, should declare a `contentPolicy` field in package.json and ship a text-only `DISCLOSURE` file describing the functionality and its legitimate use, so the scanner classifies deliberate capability instead of guessing. Fresh triggers stack: first-ever release, a repo that was private until just before publishing, placeholder versions in the history.

## Related restrictions from the same program

- Tokens that bypass 2FA are being restricted for account changes and direct publishing, which is the `npm-gat-bypass2fa-deprecation` notice on every CLI run. `npm trust` and other settings writes demand a 2FA-fresh session even for reads; see the trust-sweep's fail-closed handling.
- Web-login and 2FA-approval sessions are short-lived: URLs expire in minutes, and the cooldown window only registers when a live waiting command completes through the approval (`trust-sweep.mts`'s in-flow window reopening exists for exactly this).
