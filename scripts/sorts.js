'use strict'

const { compare: localCompare } = new Intl.Collator()

function toSortedObject(object, comparator = localCompare) {
  return Object.fromEntries(
    Object.entries(object).sort((a, b) => comparator(a[0], b[0]))
  )
}

module.exports = {
  localCompare,
  toSortedObject
}
