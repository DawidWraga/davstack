// Fixed-capacity circular buffer. Oldest entries overwritten when full.
// Used to cap memory for live daemon stdout/stderr streams in the TUI.

export class RingBuffer<T> {
  private buf: (T | undefined)[]
  private writeIdx = 0
  private count = 0
  private readonly capacity: number

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`RingBuffer capacity must be a positive integer, got ${capacity}`)
    }
    this.capacity = capacity
    this.buf = new Array(capacity)
  }

  push(item: T): void {
    this.buf[this.writeIdx] = item
    this.writeIdx = (this.writeIdx + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  toArray(): T[] {
    const out: T[] = []
    if (this.count < this.capacity) {
      for (let i = 0; i < this.count; i++) out.push(this.buf[i] as T)
      return out
    }
    // Full — oldest entry sits at writeIdx (the next slot to overwrite).
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.writeIdx + i) % this.capacity
      out.push(this.buf[idx] as T)
    }
    return out
  }

  get size(): number {
    return this.count
  }

  clear(): void {
    this.buf = new Array(this.capacity)
    this.writeIdx = 0
    this.count = 0
  }
}
