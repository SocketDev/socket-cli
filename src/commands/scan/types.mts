/** @fileoverview Type definitions for Socket CLI scan commands. Defines fold settings for report grouping and report severity levels. */

export type FOLD_SETTING = 'pkg' | 'version' | 'file' | 'none'

export type REPORT_LEVEL = 'defer' | 'ignore' | 'monitor' | 'warn' | 'error'
