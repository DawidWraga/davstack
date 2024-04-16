/* eslint-disable no-unused-vars */
import { Simplify, StoreApi } from '../types';
import { StoreMethods } from '../types/store-methods';

export type ComputedProps = Record<string, () => any>;

export type ComputedMethods<TComputedProps extends ComputedProps> = {
	[K in keyof TComputedProps]: Pick<
		StoreMethods<Simplify<ReturnType<TComputedProps[K]>>>,
		'use' | 'get'
	>;
};

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
	// Retrieve keys to know which properties are being computed
	const computedKeys = Object.keys(
		computedCallback(
			new Proxy(store as any, {
				// Creating a dummy proxy to extract computed keys without any side effects
				get: (target, prop) => {
					if (prop === 'get' || prop === 'use') {
						return () => {}; // Return a dummy function for initialization purposes
					}
					return Reflect.get(target, prop);
				},
			})
		)
	) as (keyof TComputedProps)[];

	const computedProperties = computedCallback(store);

	const computedMethods = Object.fromEntries(
		computedKeys.map((key) => {
			return [
				key,
				{
					use: () => computedProperties[key](),
					get: () => {
						// @ts-expect-error
						store._replaceUseWithGet = true;

						const result = computedCallback(store)[key]();
						// @ts-expect-error
						store._replaceUseWithGet = false;

						return result;
					},
				},
			];
		})
	) as ComputedMethods<TComputedProps>;

	return computedMethods;
}
