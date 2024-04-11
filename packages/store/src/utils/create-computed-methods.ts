/* eslint-disable no-unused-vars */
import { isObject } from '../store';
import { NestedStoreMethods, Simplify, State, StoreMethods } from '../types';

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

export const computed = <T extends State, TComputedProps extends ComputedProps>(
	methods: NestedStoreMethods<T>,
	computedCallback: ComputedBuilder<T, TComputedProps>
) => {
	function getStateCallbacks() {
		const stateValue = methods.get();

		// handle primative values
		if (!isObject(stateValue)) {
			const dummy = { get: () => {} };
			const computedKeys = Object.keys(computedCallback(dummy as any));
			return {
				stateGetters: { get: methods.get },
				stateHooks: { get: methods.use },
				computedKeys,
			};
		}

		// handle object values
		const stateKeys = Object.keys(methods.get() as object) as (keyof T)[];

		const stateMethods_dummy = Object.fromEntries(
			stateKeys.map((key) => {
				return [key, () => {}];
			})
		) as NestedStateSubscriptionMethods<T>;

		const computedKeys = Object.keys(
			computedCallback(stateMethods_dummy)
		) as (keyof TComputedProps)[];

		const stateGetters = Object.fromEntries(
			stateKeys.map((key) => {
				// @ts-expect-error
				return [key, { get: methods[key].get }];
			})
		) as NestedStateSubscriptionMethods<T>;

		const stateHooks = Object.fromEntries(
			stateKeys.map((key) => {
				// @ts-expect-error
				return [key, { get: methods[key].use }];
			})
		) as NestedStateSubscriptionMethods<T>;

		return {
			stateGetters,
			stateHooks,
			computedKeys,
		};
	}

	const { stateGetters, stateHooks, computedKeys } = getStateCallbacks();

	const computedMethods = Object.fromEntries(
		computedKeys.map((key) => {
			return [
				key,
				{
					// @ts-expect-error
					get: (...args) => {
						// @ts-expect-error
						const allCallbacks = computedCallback(stateGetters);
						// @ts-expect-error
						return allCallbacks[key](...args);
					},

					// @ts-expect-error
					use: (...args) => {
						// @ts-expect-error
						return computedCallback(stateHooks)[key](...args);
					},
				},
			];
		})
	) as unknown as ComputedMethods<TComputedProps>;

	return computedMethods;
};
