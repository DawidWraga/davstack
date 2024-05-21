# @davstack/store

## 1.2.0

### Minor Changes

- add computed read input, setter, and add withProvider to createStoreContext

### Patch Changes

- fix: null initial state should start as null instead of defaulting to {}

## 1.1.3

### Patch Changes

- tweak extend return type to allow for non-function extensions

## 1.1.1

### Patch Changes

- add improved types for providers with input

## 1.1.0

### Minor Changes

- create global store instance lazily, improving performance for non-global stores and consoldating store and storeBuilder

## 1.0.1

### Patch Changes

- Changed how computed values are accessed

## 1.0.0

### Major Changes

- Added unlimited nesting with proxy methods, .onChange, effects, and computed values.

## 0.2.0

### Minor Changes

- add support for primative store types and 2 level-deep object stores. Also rename createStore to store, to avoid confusion with zustand createStore fn

## 0.1.5

### Patch Changes

- refactor types

## 0.1.2

### Patch Changes

- b4a96f9: add doc link to package json

## 0.1.0

### Minor Changes

- initial changeset
