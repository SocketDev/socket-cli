/**
 * Platform detection and OS-specific constants.
 */

import { platform } from 'os'

// Platform detection.
const _platform = platform()
export const DARWIN = _platform === 'darwin'
export const WIN32 = _platform === 'win32'

// File permission modes.
export const S_IXUSR = 0o100
export const S_IXGRP = 0o010
export const S_IXOTH = 0o001
