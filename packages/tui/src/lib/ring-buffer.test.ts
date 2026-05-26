import { test, expect, describe } from "vitest"

import { RingBuffer } from "./ring-buffer.ts"

describe("RingBuffer", () => {
  test("empty buffer has size 0 and empty array", () => {
    const rb = new RingBuffer<number>(5)
    expect(rb.size).toBe(0)
    expect(rb.toArray()).toEqual([])
  })

  test("partial fill preserves insertion order", () => {
    const rb = new RingBuffer<number>(5)
    rb.push(1)
    rb.push(2)
    rb.push(3)
    expect(rb.size).toBe(3)
    expect(rb.toArray()).toEqual([1, 2, 3])
  })

  test("exactly-full fill preserves all entries in order", () => {
    const rb = new RingBuffer<number>(3)
    rb.push(1)
    rb.push(2)
    rb.push(3)
    expect(rb.size).toBe(3)
    expect(rb.toArray()).toEqual([1, 2, 3])
  })

  test("wraps once: oldest entry overwritten", () => {
    const rb = new RingBuffer<number>(3)
    rb.push(1)
    rb.push(2)
    rb.push(3)
    rb.push(4)
    expect(rb.size).toBe(3)
    expect(rb.toArray()).toEqual([2, 3, 4])
  })

  test("wraps many times: only last `capacity` entries remain", () => {
    const rb = new RingBuffer<number>(3)
    for (let i = 1; i <= 10; i++) rb.push(i)
    expect(rb.size).toBe(3)
    expect(rb.toArray()).toEqual([8, 9, 10])
  })

  test("clear resets size and contents but capacity remains", () => {
    const rb = new RingBuffer<number>(3)
    rb.push(1)
    rb.push(2)
    rb.clear()
    expect(rb.size).toBe(0)
    expect(rb.toArray()).toEqual([])
    rb.push(42)
    expect(rb.toArray()).toEqual([42])
  })

  test("rejects non-positive capacity", () => {
    expect(() => new RingBuffer<number>(0)).toThrow()
    expect(() => new RingBuffer<number>(-1)).toThrow()
    expect(() => new RingBuffer<number>(1.5)).toThrow()
  })
})
