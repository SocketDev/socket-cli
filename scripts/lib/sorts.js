'use strict'

let naturalCompareFn
function naturalCompare(a, b) {
  naturalCompareFn ??= new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  }).compare
  return naturalCompareFn(a, b)
}

module.exports = { naturalCompare }
