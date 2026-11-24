'use strict'

function envAsBoolean(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '1' || trimmed.toLowerCase() === 'true'
  }
  return value == null ? false : !!value
}

function envAsString(value, defaultValue = '') {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (value == null) {
    return defaultValue === '' ? defaultValue : String(defaultValue).trim()
  }
  return String(value).trim()
}

module.exports = { envAsBoolean, envAsString }
