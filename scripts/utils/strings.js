'use strict'

function search(str, regexp, fromIndex = 0) {
  const { length } = str
  if (fromIndex >= length) return -1
  if (fromIndex === 0) return str.search(regexp)
  const offset = fromIndex < 0 ? Math.max(length + fromIndex, 0) : fromIndex
  const result = str.slice(offset).search(regexp)
  return result === -1 ? -1 : result + offset
}

module.exports = {
  search
}
