/**
 * Yoga Layout Enums
 *
 * Provides enum definitions matching Yoga's API for compatibility.
 */

export const Align = {
  Auto: 0,
  FlexStart: 1,
  Center: 2,
  FlexEnd: 3,
  Stretch: 4,
  Baseline: 5,
  SpaceBetween: 6,
  SpaceAround: 7,
  SpaceEvenly: 8,
}

export const Direction = {
  Inherit: 0,
  LTR: 1,
  RTL: 2,
}

export const Display = {
  Flex: 0,
  None: 1,
}

export const Edge = {
  Left: 0,
  Top: 1,
  Right: 2,
  Bottom: 3,
  Start: 4,
  End: 5,
  Horizontal: 6,
  Vertical: 7,
  All: 8,
}

export const FlexDirection = {
  Column: 0,
  ColumnReverse: 1,
  Row: 2,
  RowReverse: 3,
}

export const Justify = {
  FlexStart: 0,
  Center: 1,
  FlexEnd: 2,
  SpaceBetween: 3,
  SpaceAround: 4,
  SpaceEvenly: 5,
}

export const Wrap = {
  NoWrap: 0,
  Wrap: 1,
  WrapReverse: 2,
}

export const Unit = {
  Undefined: 0,
  Point: 1,
  Percent: 2,
  Auto: 3,
}

export const MeasureMode = {
  Undefined: 0,
  Exactly: 1,
  AtMost: 2,
}

export const Overflow = {
  Visible: 0,
  Hidden: 1,
  Scroll: 2,
}

export const PositionType = {
  Static: 0,
  Relative: 1,
  Absolute: 2,
}

export const Gutter = {
  Column: 0,
  Row: 1,
  All: 2,
}

export const Errata = {
  None: 0,
  StretchFlexBasis: 1,
  AbsolutePositioningIncorrect: 2,
  AbsolutePercentAgainstInnerSize: 4,
  All: 2147483647,
  Classic: 2147483646,
}

export const ExperimentalFeature = {
  WebFlexBasis: 0,
}
