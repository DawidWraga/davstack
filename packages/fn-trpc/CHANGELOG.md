# @davstack/fn-trpc

## 0.2.0

### Minor Changes

- 7f76113: Initial release: tRPC adapter for `@davstack/fn` (`initProcedureFactory`), extracted from the core package.

### Patch Changes

- Prefer a declared `outputSchema` over inferring the handler return type, to keep consumer tRPC router types flat and avoid TS-server lag.
- Updated dependencies [40b8db5]
  - @davstack/fn@2.0.0
