## List the exact signature and return type of every exported symbol in the scratch lib

src/math.ts:1-1
```
export function add(a: number, b: number): number {
```

src/math.ts:5-5
```
export const subtract = (a: number, b: number): number => a - b
```

src/strings.ts:1-1
```
export function capitalize(s: string): string {
```

src/index.ts:1-1
```
export { add, subtract } from "./math"
```

src/index.ts:2-2
```
export { capitalize } from "./strings"
```
