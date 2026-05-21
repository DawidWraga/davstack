/**
 * This is a archive of one possible solution for the computed methods
 *
 * insetad of replacing get with use, we pass a "getOrUse" parameter to the computedCallback
 */

/* eslint-disable no-unused-vars */
import { Simplify, StoreApi } from '../types';
import { State } from '../create-state-methods/state.types';

export type ComputedProps = Record<string, () => any>;

export type ComputedMethods<TComputedProps extends ComputedProps> = {
	[K in keyof TComputedProps]: Pick<
		State<Simplify<ReturnType<TComputedProps[K]>>>,
		'use' | 'get'
	>;
};

export type ComputedBuilder<
	TStore extends StoreApi<any, any>,
	TComputedProps extends ComputedProps,
> = (store: TStore, getOrUse: 'get' | 'use') => TComputedProps;

export function computedAlt<
	TStore extends StoreApi<any, any>,
	TComputedProps extends ComputedProps,
>(
	store: TStore,
	computedCallback: ComputedBuilder<TStore, TComputedProps>
): ComputedMethods<TComputedProps> {
	const initialValues = computedCallback(store, 'get');

	const getters = Object.fromEntries(
		Object.keys(initialValues).map((key) => {
			return [key, computedCallback(store, 'get')[key]];
		})
	);

	const hooks = Object.fromEntries(
		Object.keys(initialValues).map((key) => {
			return [key, computedCallback(store, 'use')[key]];
		})
	);

	const computedMethods = Object.fromEntries(
		Object.keys(initialValues).map((key) => {
			return [
				key,
				{
					get: getters[key],
					use: hooks[key],
				},
			];
		})
	) as ComputedMethods<TComputedProps>;

	return computedMethods;
}
