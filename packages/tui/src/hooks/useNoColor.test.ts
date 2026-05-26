// useNoColor reads env once and caches. Tests must reset the cache
// before each scenario because the module-level cache survives across
// tests in the same worker.

import { afterEach, beforeEach, expect, test } from "vitest"

import { __resetNoColorCacheForTests, colorOrUndef, useNoColor } from "./useNoColor.ts"

let prevNoColor: string | undefined
let prevDavstackNoColor: string | undefined

beforeEach(() => {
  prevNoColor = process.env.NO_COLOR
  prevDavstackNoColor = process.env.DAVSTACK_NO_COLOR
  delete process.env.NO_COLOR
  delete process.env.DAVSTACK_NO_COLOR
  __resetNoColorCacheForTests()
})

afterEach(() => {
  if (prevNoColor === undefined) delete process.env.NO_COLOR
  else process.env.NO_COLOR = prevNoColor
  if (prevDavstackNoColor === undefined) delete process.env.DAVSTACK_NO_COLOR
  else process.env.DAVSTACK_NO_COLOR = prevDavstackNoColor
  __resetNoColorCacheForTests()
})

test("returns false when no env is set", () => {
  expect(useNoColor()).toBe(false)
})

test("returns true when NO_COLOR is set to any non-empty value", () => {
  process.env.NO_COLOR = "1"
  __resetNoColorCacheForTests()
  expect(useNoColor()).toBe(true)
})

test("returns true when DAVSTACK_NO_COLOR is set (mirrors --no-color CLI flag)", () => {
  process.env.DAVSTACK_NO_COLOR = "1"
  __resetNoColorCacheForTests()
  expect(useNoColor()).toBe(true)
})

test("colorOrUndef returns the value when noColor is false", () => {
  expect(colorOrUndef("red", false)).toBe("red")
})

test("colorOrUndef returns undefined when noColor is true", () => {
  expect(colorOrUndef("red", true)).toBeUndefined()
})
