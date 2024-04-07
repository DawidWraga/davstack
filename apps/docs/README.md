# Zustand-X State Management Library

Zustand-X is a powerful and intuitive state management library for React applications. It combines the simplicity of Zustand with an ergonomic API designed to prevent common pitfalls and enable a flexible approach to handling state, actions, computed properties, and custom hooks.

## Key Features

- **Proxy-based State Management**: Leverages Zustand's proxy-based state management for fine-grained reactivity and automatic UI updates.
- **Ergonomic API**: Provides a fluent and intuitive API for defining state, actions, computed properties, and custom hooks.
- **Computed Properties**: Define derived state that automatically updates when dependent state changes.
- **Actions**: Mutate state with actions defined as part of the store.
- **Custom Hooks Integration**: Seamlessly integrate custom hooks into your store for extended functionality.
- **Local and Global State Management**: Supports both global state management across your app and local state scoped to component trees.
- **Immutable Snapshots**: Access immutable snapshots of the state for use in non-reactive contexts.
- **TypeScript Support**: Offers strong typing and type inference for enhanced development experience and code maintainability.

## Installation

```bash
npm install zustand-x
```

## Getting Started

### Creating a Store

To create a store, use the `store` function and define your initial state:

```tsx
import { store } from 'zustand-x';

const counterStore = store({
	count: 0,
});
```

### Defining Actions and Computed Properties

Use the `extend` method to define actions and computed properties:

```tsx
const counterStore = store({ count: 0 }).extend((store) => ({
	increment() {
		store.count.set(store.count.get() + 1);
	},
	decrement() {
		store.count.set(store.count.get() - 1);
	},
	getDoubled() {
		return store.count.get() * 2;
	},
}));
```

### Using Store in Components

Access state, computed properties, and actions in your components using the `use` method:

```tsx
import React from 'react';
import { counterStore } from './store';

const Counter = () => {
	const count = counterStore.count.use();
	const doubled = counterStore.getDoubled();

	return (
		<div>
			<p>Count: {count}</p>
			<p>Doubled: {doubled}</p>
			<button onClick={counterStore.increment}>Increment</button>
			<button onClick={counterStore.decrement}>Decrement</button>
		</div>
	);
};
```

### Updating State

Update state using the `set` method or by directly mutating state properties within actions:

```tsx
counterStore.count.set(10);
counterStore.set({ count: 10 });
counterStore.set((state) => {
	state.count = 10;
});
```

### Accessing State Outside Components

Get a non-reactive snapshot of the state using the `get` method:

```tsx
const currentCount = counterStore.count.get();
```

### Local State Management

Use the `LocalProvider` component to scope state to a subtree of components:

```tsx
import React from 'react';
import { counterStore } from './store';

const ParentComponent = () => {
	return (
		<counterStore.LocalProvider initialValue={{ count: 5 }}>
			<ChildComponent />
		</counterStore.LocalProvider>
	);
};

const ChildComponent = () => {
	const localStore = counterStore.useLocalStore();
	const count = localStore.count.use();

	return <div>Count: {count}</div>;
};
```

## Best Practices

- Always call `store` first to define the initial state before chaining other methods.
- Use `extend` to define actions and computed properties. Multiple calls to `extend` will merge the properties.
- Access state, computed properties, and actions using the `use`, `get`, and direct property access methods.
- Avoid overwriting the store instance directly, as it will break the reactivity.
- Use `LocalProvider` to scope state to a subtree of components when needed.

## Caveats

- Not all data types can be proxied (e.g., HTML elements). Use Zustand's `ref` helper to store unproxied values in the state.
- Maps and Sets cannot be proxied by default. Use Zustand's `proxySet` and `proxyMap` helpers to proxy them.

For more detailed examples and advanced usage, please refer to the [documentation](link-to-documentation) and [examples](link-to-examples).

## Contributing

Contributions are welcome! Please read our [contributing guide](link-to-contributing-guide) for details on our code of conduct and the submission process.

## License

This project is licensed under the [MIT License](link-to-license). See the LICENSE file for details.
