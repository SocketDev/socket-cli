/**
 * @fileoverview Intl stub polyfill - backward compatibility entry point.
 *
 * This file re-exports from the modular intl-stub directory structure.
 * Import this file to automatically install Intl stubs if Intl is missing.
 */

export {
  CollatorStub,
  DateTimeFormatStub,
  DisplayNamesStub,
  ListFormatStub,
  LocaleStub,
  NumberFormatStub,
  PluralRulesStub,
  RelativeTimeFormatStub,
  SegmenterStub,
} from './intl-stub/index.mts'

// Import the index to trigger automatic installation.
import './intl-stub/index.mts'
