import { describe, expect, it } from 'vitest'

import { quotePowerShell } from '../../../src/utils/quote-powershell.mts'

describe('quotePowerShell', () => {
  it('wraps a value in a PowerShell single-quoted string', () => {
    expect(quotePowerShell('C:\\tools\\node.zip')).toBe("'C:\\tools\\node.zip'")
  })

  it('doubles single quotes inside the value', () => {
    expect(quotePowerShell("C:\\Users\\O'Neil\\node.zip")).toBe(
      "'C:\\Users\\O''Neil\\node.zip'",
    )
  })

  it('leaves PowerShell expansion characters literal', () => {
    expect(quotePowerShell('$(Write-Host `value`)')).toBe(
      "'$(Write-Host `value`)'",
    )
  })
})
