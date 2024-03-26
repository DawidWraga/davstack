# DavStack Store

The most intuitive and practical React state management library, built on top of [Zustand](https://github.com/pmndrs/zustand).

Zustand is a small, fast and scalable state-management solution battle-tested against common pitfalls, like the dreaded [zombie child problem](https://react-redux.js.org/api/hooks#stale-props-and-zombie-children), [react concurrency](https://github.com/bvaughn/rfcs/blob/useMutableSource/text/0000-use-mutable-source.md), and [context loss](https://github.com/facebook/react/issues/13332) between mixed renderers.

### Key Features

1. **Simple API**: Just define the initial state, getters/setters/hooks/types are automatically generated. No need to write boilerplate code.
2. **Computed Properties and Actions**: Define derived state and actions that automatically update when dependent state changes.
3. **Local State Management**: Scope state to a subtree of components using the `LocalProvider` component.

### Installation

```bash
npm install zustand @davstack/store
```

Visit the [DavStack Store Docs](https://davstack.com/store/overview) for more information and examples, such as this [todo app example](https://davstack.com/store/todo-example).

### Creating a Store

Types are inferred from the initial state object.

```tsx
import { createStore } from '@davstack/store';

const counterStore = createStore({ count: 0 });
```

### Subscribing to State Changes

Subscribe to state changes inside React components using the auto-generated `use` hook.

```tsx
const Counter = () => {
	const count = counterStore.count.use();

	return <div>Count: {count}</div>;
};
```

### Updating State

Update state using the auto-generated `set` method. DavStack Store uses Immer under the hood, allowing you to update state immutably.

```tsx
counterStore.count.set(10);
```

### Accessing the state without subscribing

This will not cause the component to re-render when the state changes.
Useful for accessing state inside callbacks.

```tsx
const handleSubmit = async () => {
	const count = counterStore.count.get();
	// ...
};
```

### Store Methods

Every key inside the store initial value automatically gets a `use`, `set`, and `get` method. You can also access the same methods on the store itself. Additionally, the store has a `assign` method to update multiple properties at once.

```tsx
const counterStore = createStore({
	count: 0,
	secondCount: 0,
});

// Subscribe inside a component
const { count, secondCount } = counterStore.use();

// Access state without subscribing, eg in callbacks
const { count, secondCount } = counterStore.get();

counterStore.set((draft) => {
	// Uses immer under the hood to update state immutably
	draft.count = 10;
});

// Update multiple properties at once
counterStore.assign({ count: 10, secondCount: 20 });
```

Note: using the `store.use()` will subscribe the component to the entire store, causing it to re-render whenever any property changes. For better performance, it is recommended to use the `store.[selector].use` method to subscribe to individual properties eg `counterStore.count.use()`.

### Defining Actions and Computed Properties

Use the `extend` method to define actions and computed properties. Extensions not only help to keep relevant code neatly packaged into one object but also impact the scoped store if you are using `LocalProvider`.

```tsx
const counterStore = createStore({ count: 0 }).extend((store) => ({
	increment() {
		store.count.set(store.count.get() + 1);
	},
	decrement() {
		store.count.set(store.count.get() - 1);
	},
	useDoubled() {
		return store.count.use() * 2;
	},
}));

const Counter = () => {
	const count = counterStore.count.use();
	const doubled = counterStore.useDoubled();

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

### Local State Management

By default, stores are global and work without the need for any provider. However, if you require locally scoped stores, DavStack Store makes it super easy using the `LocalProvider` component.

```tsx
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

### Performance Optimizations

The `useTracked` method from `react-tracked` can be used for performance optimizations by minimizing unnecessary re-renders. This uses proxies under the hood to track which properties are accessed.

```tsx
const Counter = () => {
	// only rerenders when properties accessed using . notation have changed
	const state = counterStore.useTracked();

	// only rerenders when count has changed
	const count = counterStore.count.useTracked();
	// ...
};
```

### Options

The `createStore` function accepts an optional second parameter for options,

```tsx
const counterStore = createStore(
	{ count: 0 },

	{
		middlewares: [],
		devtools: true,
		persist: true,
		immer: true,
		name: 'counterStore',
	}
);
```

- `middlewares`: an array of middleware functions
- `devtools`: a boolean to enable/disable devtools integration
- `persist`: a boolean to enable/disable state persistence
- `immer`: a boolean to enable/disable immer integration
- `name`: a string to name the store, used for devtools

### Acknowledgements

DavStack Store wouldn't be possible without the incredible work done by the Zustand creators. We'd also like to give a shout-out to [Zustand X](https://github.com/udecode/zustand-x) for inspiring some of the code in this library.

### Contributing

Contributions are welcome! Please read our [contributing guide](link-to-contributing-guide) for details on our code of conduct and the submission process.

### License

This project is licensed under the [MIT License](link-to-license). See the LICENSE file for details.
