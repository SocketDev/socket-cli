// Inspired by "balanced-match":
// https://socket.dev/npm/package/balanced-match/overview/3.0.1
// MIT License
// Copyright (c) 2013 Julian Gruber <julian@juliangruber.com>
export function isBalanced(
  startPattern: string,
  endPattern: string,
  source: string
) {
  let startPatternIndex = source.indexOf(startPattern)
  let endPatternIndex = source.indexOf(endPattern, startPatternIndex + 1)
  let currentIndex = startPatternIndex

  // This method can be transitioned into a "getRange" variation by replacing
  // relevant lines below with their commented out alternatives.
  if (startPatternIndex === -1 || endPatternIndex < 1) {
    return false // return undefined
  }
  if (startPattern === endPattern) {
    return true // return [startPatternIndex, endPatternIndex]
  }
  const startIndices = []
  while (currentIndex !== -1) {
    if (currentIndex === startPatternIndex) {
      startIndices.push(currentIndex)
      startPatternIndex = source.indexOf(startPattern, currentIndex + 1)
    } else if (startIndices.length === 1) {
      return true // return [startIndices[0], endPatternIndex]
    } else {
      startIndices.pop()
      endPatternIndex = source.indexOf(endPattern, currentIndex + 1)
    }
    currentIndex =
      startPatternIndex !== -1 && startPatternIndex < endPatternIndex
        ? startPatternIndex
        : endPatternIndex
  }
  return false // return undefined
}

export function isNonEmptyString(value: any): value is string {
  return typeof value === 'string' && value.length > 0
}
