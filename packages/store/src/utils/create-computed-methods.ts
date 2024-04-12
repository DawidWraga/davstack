/* eslint-disable no-unused-vars */
import { Simplify, StoreApi } from '../types';
import { StoreMethods } from '../types/store-methods';

export type ComputedProps = Record<string, () => any>;

export type ComputedMethods<TComputedProps extends ComputedProps> = {
	[K in keyof TComputedProps]: Pick<
		StoreMethods<Simplify<ReturnType<TComputedProps[K]>>, object>,
		'use' | 'get'
	>;
};
// Context to manage whether 'get' should be intercepted
let replaceGetWithUse = false;
export type ComputedBuilder<
	TStore extends StoreApi<any, any>,
	TComputedProps extends ComputedProps,
> = (store: TStore) => TComputedProps;

export function computed<
	TStore extends StoreApi<any, any>,
	TComputedProps extends ComputedProps,
>(
	store: TStore,
	computedCallback: ComputedBuilder<TStore, TComputedProps>
): ComputedMethods<TComputedProps> {
	const handler = {
		// @ts-expect-error
		get: (target, prop, receiver) => {
			if (prop === 'get' && replaceGetWithUse) {
				return target.use;
			}
			return Reflect.get(target, prop, receiver);
		},
	};

	// Creating a dummy proxy to extract computed keys without any side effects
	// @ts-expect-error
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
	// @ts-expect-error
	const computedKeys = Object.keys(computedCallback(dummyProxy));

	// Setup real proxies based on computed keys
	const proxyStore = new Proxy(store, handler);

	const computedProperties = computedCallback(proxyStore);

	const computedMethods = computedKeys.reduce((acc, key) => {
		// @ts-expect-error
		acc[key] = {
			get: () => computedProperties[key](),
			use: () => {
				replaceGetWithUse = true;
				// Use the realProxy here to ensure `get` is replaced by `use` during the execution
				const result = computedProperties[key as keyof TComputedProps]();
				replaceGetWithUse = false;
				return result;
			},
		};
		return acc;
	}, {} as ComputedMethods<TComputedProps>);

	return computedMethods;
}
