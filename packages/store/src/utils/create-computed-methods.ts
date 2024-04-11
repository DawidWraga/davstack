/* eslint-disable no-unused-vars */
import {
	NestedStoreMethods,
	Simplify,
	State,
	StoreApi,
	StoreMethods,
} from '../types';

type StateSubscriptionMethods<T extends State> = {
	/**
	 * .get represents getting the state, but if computed value is callde with .use then it will call .use under the hood instead, so be careful to follow the rules of hooks.
	 */
	get: () => T;
};

export type NestedStateSubscriptionMethods<TState> =
	StateSubscriptionMethods<TState> &
		(TState extends object
			? { [TKey in keyof TState]: NestedStoreMethods<TState[TKey]> }
			: {});

export type ComputedProps = Record<string, () => any>;

export type ComputedMethods<TComputedProps extends ComputedProps> = {
	[K in keyof TComputedProps]: Omit<
		StoreMethods<Simplify<ReturnType<TComputedProps[K]>>>,
		'set' | 'assign'
	>;
};

export type ComputedBuilder<
	T extends State,
	TComputedProps extends ComputedProps,
> = (state: NestedStateSubscriptionMethods<T>) => TComputedProps;

export function computed<
	TState extends State,
	TComputedProps extends ComputedProps,
>(
	store: StoreApi<TState>,
	computedCallback: ComputedBuilder<TState, TComputedProps>
): ComputedMethods<TComputedProps> {
	const handler = {
		// @ts-expect-error
		get: (target, prop, receiver) => {
			if (prop === 'get') {
				// Dynamically replace `get` with `use` only during the `use` method call of computed properties
				const stack = new Error().stack;
				if (stack && stack.includes('.use@')) {
					return target.use;
				}
			}
			return Reflect.get(target, prop, receiver);
		},
	};

	// Creating a dummy proxy to extract computed keys without any side effects
	const dummyProxy = new Proxy(store, {
		get: (target, prop) => {
			if (prop === 'get' || prop === 'use') {
				return () => {}; // Return a dummy function for initialization purposes
			}
			// @ts-expect-error
			return target[prop];
		},
	});

	// Retrieve keys to know which properties are being computed
	const computedKeys = Object.keys(computedCallback(dummyProxy));

	// Setup real proxies based on computed keys
	const proxyStore = new Proxy(store, handler);

	const computedProperties = computedCallback(proxyStore);

	const computedMethods = computedKeys.reduce((acc, key) => {
		// @ts-expect-error
		acc[key] = {
			get: () => computedProperties[key](),
			use: () => {
				// Use the realProxy here to ensure `get` is replaced by `use` during the execution
				return computedProperties[key]();
			},
		};
		return acc;
	}, {} as ComputedMethods<TComputedProps>);

	return computedMethods;
}
