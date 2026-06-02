---
description: Load the Socket Trusted Publisher extension unpacked in Chrome and verify it can reach the native messaging host. Covers build, load-unpacked steps, and connection check.
---

Set up the Socket Trusted Publisher browser extension.

## What this does

1. Builds the extension bundle
2. Guides you through loading it unpacked in Chrome
3. Verifies the native messaging host connection

## Prerequisites

Run these first (in order):

```bash
/setup-token          # API token in keychain
/setup-native-host    # Chrome host manifest installed
```

## Step 1 — Build

```bash
pnpm --filter @socketsecurity/trusted-publisher-extension build
```

The bundle lands in `tools/trusted-publisher-extension/dist/`.

## Step 2 — Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select: `tools/trusted-publisher-extension/` (the directory containing `manifest.json`, **not** `dist/`)

The Socket shield icon appears in the toolbar. Pin it for easy access.

## Step 3 — Verify native host connection

Open the extension popup. The **Staged Release Review** section should load staged releases (if any) without a "token not found" error. If it errors:

1. Confirm `/setup-native-host` completed successfully
2. Confirm `/setup-token` stored the token: `security find-generic-password -s socket-cli -a SOCKET_API_TOKEN -w`
3. Reload the extension at `chrome://extensions` after any host changes

## Hot-reload during development

```bash
pnpm --filter @socketsecurity/trusted-publisher-extension build:watch
```

After Chrome shows stale behavior, click the reload icon on `chrome://extensions` for this extension, then refresh any open npmjs.com tabs.

## Notes

- The extension ID changes every time you load it unpacked on a new machine — update `allowedOrigins` in the native host manifest if you need a stable ID (use a packed `.crx` instead)
- `manifest.json` declares `"nativeMessaging"` permission — Chrome will prompt once for host access
