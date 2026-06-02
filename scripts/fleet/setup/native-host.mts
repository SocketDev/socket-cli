#!/usr/bin/env node
/**
 * @file Install the Chrome native messaging host manifest so the Socket Trusted
 *   Publisher extension can read the API token from the OS keychain. Manifest
 *   paths: macOS ~/Library/Application
 *   Support/Google/Chrome/NativeMessagingHosts/ ~/Library/Application
 *   Support/Chromium/NativeMessagingHosts/ Linux
 *   ~/.config/google-chrome/NativeMessagingHosts/
 *   ~/.config/chromium/NativeMessagingHosts/ Windows
 *   %APPDATA%\Google\Chrome\User Data\NativeMessagingHosts\ + HKCU key Usage:
 *   node scripts/fleet/setup/native-host.mts.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

async function main(): Promise<void> {
  const logger = getDefaultLogger()
  try {
    const { HOST_NAME, installNativeHost } =
      await import('@socketsecurity/lib-stable/native-messaging/install')
    const result = installNativeHost({ allowedOrigins: ['*'] })
    logger.log(`Native host: ${HOST_NAME}`)
    for (const p of result.manifestPaths) {
      logger.log(`  manifest: ${p}`)
    }
    logger.log(`  wrapper:  ${result.wrapperPath}`)
    logger.log('')
    logger.log(
      'Native host installed. Reload Chrome extensions if already open.',
    )
  } catch (e) {
    logger.error(`Native host install failed: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}

void main()
