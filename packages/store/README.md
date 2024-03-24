# DavStack Store

Davstack store is a state management library built on top of zustand that provides a more practical API for managing state in React applications, with support for actions, computed properties, and local state management.

[Zustand](https://github.com/pmndrs/zustand) is a small, fast and scalable state-management solution battle-tested against common pitfalls, like the dreaded [zombie child problem](https://react-redux.js.org/api/hooks#stale-props-and-zombie-children), [react concurrency](https://github.com/bvaughn/rfcs/blob/useMutableSource/text/0000-use-mutable-source.md), and [context loss](https://github.com/facebook/react/issues/13332) between mixed renderers.

## Key Features

1. **Simple API**: Define state and getters/setters/hooks/types are automatically generated. No need to write boilerplate code.

```tsx
import { createStore } from '@davstack/store';

const personStore = createStore({
	name: 0,
});

const Component = () => {
	const name = personStore.name.use();

	return (
		<input
			value={name}
			onChange={(e) => {
				personStore.name.set(e.target.value);
			}}
		/>
	);
};
```

## Installation

```bash
npm install @davstack/store
```

## Getting Started

# Creating a Store

To create a store, use the `createStore` function and define your initial state:

```tsx
import { createStore } from '@davstack/store';

const counterStore = createStore({
	count: 0,
});
```

### Defining Actions and Computed Properties

Use the `extend` method to define actions and computed properties:

```tsx
const counterStore = createStore({ count: 0 }).extend((store) => ({
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
counterStore.set((state) => {
	state.count = 10;
});
counterStore.assign({ count: 10 });
```

### Accessing State Outside Components

Get a snapshot of the state using the `get` method:

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

- Always call `createStore` first to define the initial state before chaining other methods.
- Use `extend` to define actions and computed properties. Multiple calls to `extend` will merge the properties.
- Access state, computed properties, and actions using the `use`, `get`, and direct property access methods.
- Avoid overwriting the store instance directly, as it will break the reactivity.
- Use `LocalProvider` to scope state to a subtree of components when needed.
- Consider using `useTracked` for performance optimizations in components that only depend on a subset of the state.

## Caveats

- The library is designed to work with React and may not be suitable for other frameworks or non-React environments.
- Be mindful of the order in which you call the store methods. `createStore` should always be called first, followed by `extend` and other methods.

For more detailed examples and advanced usage, please refer to the [documentation](link-to-documentation) and [examples](link-to-examples).

## Contributing

Contributions are welcome! Please read our [contributing guide](link-to-contributing-guide) for details on our code of conduct and the submission process.

## License

This project is licensed under the [MIT License](link-to-license). See the LICENSE file for details.
