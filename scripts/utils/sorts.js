'use strict'

const { compare: localeCompare } = new Intl.Collator()

function toSortedObject(object, comparator = localeCompare) {
  return Object.fromEntries(
    Object.entries(object).sort((a, b) => comparator(a[0], b[0]))
  )
}

module.exports = {
  localeCompare,
  toSortedObject
}
