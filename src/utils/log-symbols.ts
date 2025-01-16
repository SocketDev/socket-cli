import colors from 'yoctocolors-cjs'

import isUnicodeSupported from '@socketregistry/is-unicode-supported/index.cjs'

export const logSymbols = isUnicodeSupported()
  ? {
      __proto__: null,
      info: colors.blue('ℹ'),
      success: colors.green('✔'),
      warning: colors.yellow('⚠'),
      error: colors.red('✖️')
    }
  : {
      __proto__: null,
      info: colors.blue('i'),
      success: colors.green('√'),
      warning: colors.yellow('‼'),
      error: colors.red('×')
    }
