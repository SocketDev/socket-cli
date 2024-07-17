'use strict'

const { compare: localCompare } = new Intl.Collator()

function toSortedObject(object) {
  const entries = Object.entries(object).sort((a, b) =>
    localCompare(a[0], b[0])
  )
  return Object.fromEntries(entries)
}

module.exports = {
  localCompare,
  toSortedObject
}
