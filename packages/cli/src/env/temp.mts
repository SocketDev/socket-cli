/**
 * TEMP environment variable. Temporary directory path (Windows systems).
 */

import { getTemp } from "@socketsecurity/lib-stable/env/temp-dir";

export const TEMP = getTemp();
