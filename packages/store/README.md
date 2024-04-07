# Davstack Store

Davstack store is an intuitive and practical React state management library, built on top of [Zustand](https://github.com/pmndrs/zustand).

Zustand is a small, fast and scalable state-management solution battle-tested against common pitfalls, like the dreaded [zombie child problem](https://react-redux.js.org/api/hooks#stale-props-and-zombie-children), [react concurrency](https://github.com/bvaughn/rfcs/blob/useMutableSource/text/0000-use-mutable-source.md), and [context loss](https://github.com/facebook/react/issues/13332) between mixed renderers.

### Why Use DavStack Store?

1. **Simple API**: Just define the initial state, getters/setters/hooks/types are automatically generated. No need to write boilerplate code.
2. **Computed Properties and Actions**: Define derived state and actions that automatically update when dependent state changes.
3. **Local State Management**: Scope state to a subtree of components using the `LocalProvider` component.

### Installation

```bash
npm install @davstack/store
```

Visit the [Davstack Store Docs](https://davstack.com/store/overview) for more information and examples, such as this [todo app example](https://davstack.com/store/todo-example).

## Demo Usage

### Simple primitive store example:

```tsx
import { store } from '@davstack/store';

const counterStore = store(0);

function Counter() {
	const count = counterStore.use();
	return <div>Count: {count}</div>;
}

function IncrementButton() {
	return (
		<button onClick={() => counterStore.set((state) => state + 1)}>
			Increment
		</button>
	);
}
```

### Nested object store example:

```tsx
import { store } from '@davstack/store';

const userStore = store({
	name: 'John',
	age: 25,
	address: {
		street: '123 Main St',
		city: 'Anytown',
	},
});

function UserProfile() {
	// only re-renders when name changes
	const name = userStore.name.use();

	return (
		<div>
			<p>Name: {name}</p>
		</div>
	);
}

function AddressForm() {
	const userAddress = userStore.address.use();

	return (
		<form>
			<input
				value={userAddress.street}
				onChange={(e) => userStore.address.street.set(e.target.value)}
			/>
			<input
				value={userAddress.city}
				onChange={(e) => userStore.address.city.set(e.target.value)}
			/>
		</form>
	);
}
```

## Usage guide

### Creating a Store

Types are inferred from the initial state object.

```tsx
import { store } from '@davstack/store';

// Primitive store
const counterStore = store(0);

// Nested object store
const userStore = store({
	name: 'John',
	age: 25,
	address: {
		street: '123 Main St',
		city: 'Anytown',
	},
});
```

Note: Davstack Store currently supports auto-generated methods (get, set, use, assign) for up to 2 levels of nesting eg userStore.address.street will have auto-generated methods, but userStore.address.street.deeper will not.

### Subscribing to State Changes

Subscribe to state changes inside React components using the auto-generated `use` hook.

```tsx
// Primitive store
const Counter = () => {
	const count = counterStore.use();
	return <div>Count: {count}</div>;
};

// Nested object store
const UserProfile = () => {
	const name = userStore.name.use();
	const age = userStore.age.use();
	const street = userStore.address.street.use();
	const city = userStore.address.city.use();

	return (
		<div>
			<p>Name: {name}</p>
			<p>Age: {age}</p>
			<p>
				Address: {street}, {city}
			</p>
		</div>
	);
};
```

Note: You can subscribe to changes at any level using the `use` method. For example, `userStore.address.use()` will subscribe to all changes within the `address` object, while `userStore.use()` will subscribe to changes in the entire store.

If you subscribe to specific properties, only changes to those specific properties will trigger re-renders. For example, if you only use `userStore.name.use()`, changes to `userStore.age` will not trigger re-renders in the component.

in this case, you could use `userStore.use()` to subscribe to the entire store, since all properties are used in the component. However, it is generally recommended to subscribe to specific properties to minimize re-renders and improve performance.

### Updating State

Update state using the auto-generated `set` method. Davstack Store uses Immer under the hood, allowing you to update state immutably.

```tsx
// Primitive store
counterStore.set(10);

// Nested object store
userStore.name.set('Jane');
userStore.age.set(30);
userStore.address.street.set('456 Oak St');
```

The `assign` method uses `Object.assign` under the hood to only set changed values. If the value is not an object, `assign` behaves the same as `set`.

```tsx
co;

// will set name & age, but not address
userStore.assign({
	name: 'Jane',
	age: 30,
});

// Assign also works on nested properties
userStore.address.assign({
	street: '456 Oak St',
	city: 'Newtown',
});
```

### Accessing the state without subscribing

This will not cause the component to re-render when the state changes.
Useful for accessing state inside callbacks.

```tsx
const handleSubmit = async () => {
	const count = counterStore.get();
	// ...
};
```

### Defining Actions and Computed Properties

Use the `extend` method to define actions and computed properties. Extensions not only help to keep relevant code neatly packaged into one object but also impact the scoped store if you are using `LocalProvider`.

```tsx
const userStore = store({
	name: 'John',
	age: 25,
}).extend((store) => ({
	incrementAge() {
		store.age.set(store.age.get() + 1);
	},
	useFullName() {
		return `${store.name.use()} Doe`;
	},
}));

const UserProfile = () => {
	const name = userStore.name.use();
	const age = userStore.age.use();
	const fullName = userStore.useFullName();

	return (
		<div>
			<p>Name: {name}</p>
			<p>Age: {age}</p>
			<p>Full Name: {fullName}</p>
			<button onClick={userStore.incrementAge}>Increment Age</button>
		</div>
	);
};
```

### Local State Management

By default, stores are global and work without the need for any provider. However, if you require locally scoped stores, Davstack Store makes it super easy using the `LocalProvider` component.

```tsx
const ParentComponent = () => {
	return (
		<userStore.LocalProvider initialValue={{ name: 'Jane', age: 30 }}>
			<ChildComponent />
		</userStore.LocalProvider>
	);
};

const ChildComponent = () => {
	const localStore = userStore.useLocalStore();
	const name = localStore.name.use();
	const age = localStore.age.use();

	return (
		<div>
			<p>Name: {name}</p>
			<p>Age: {age}</p>
		</div>
	);
};
```

Note: the store definition initial value will be merged the local provider initial value, which is optional.

### Options

The `store` function accepts an optional second parameter for options,

```tsx
const counterStore = store(0, {
	middlewares: [],
	devtools: true,
	persist: true,
	immer: true,
	name: 'counterStore',
});
```

- `middlewares`: an array of middleware functions
- `devtools`: a boolean to enable/disable devtools integration
- `persist`: a boolean to enable/disable state persistence
- `immer`: a boolean to enable/disable immer integration
- `name`: a string to name the store, used for devtools

### Acknowledgements

Davstack Store wouldn't be possible without the incredible work done by the Zustand creators. We'd also like to give a shout-out to [Zustand X](https://github.com/udecode/zustand-x) for inspiring some of the code in this library.

### Contributing

Contributions are welcome! Please read our [contributing guide](link-to-contributing-guide) for details on our code of conduct and the submission process.

### License

This project is licensed under the [MIT License](link-to-license). See the LICENSE file for details.
