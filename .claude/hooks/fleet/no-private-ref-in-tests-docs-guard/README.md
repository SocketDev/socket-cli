# no-private-ref-in-tests-docs-guard

Blocks `Write`/`Edit` of a unit-test or documentation file whose new content
references non-public infrastructure: a `SocketDev/<repo>` slug outside the
fleet roster, a `linear.app` issue URL, or a Slack thread link.

Tests and docs ship in public repos and survive history squashes — a private
repo name, ticket reference, or thread link in them is a durable leak. Use
fictional slugs (`acme/widgets`) in tests; omit internal references from docs.
The fleet roster (`fleet-repos.json`) is the sole sanctioned place private
repo names appear, so roster membership is exactly the public/private line
this guard draws for org slugs. Company and customer names stay with the
`private-name-nudge` reminder: a denylist of them would itself be the leak.

Bypass: `Allow private-ref-in-tests-docs bypass` (e.g. a doc legitimately
citing a public non-fleet SocketDev repo).
