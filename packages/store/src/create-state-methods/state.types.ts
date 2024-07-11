/* eslint-disable no-unused-vars */

import { EqualityChecker, Simplify, StateValue } from '../types';

type ReadonlyState<TSelector, TStateValue> = TSelector extends (state: TStateValue) => infer TReturnType
	? Readonly<TReturnType>
	: Readonly<TStateValue>;

export type State<TStateValue extends StateValue> = (TStateValue extends object
	? {
			[TKey in keyof TStateValue]: State<TStateValue[TKey]>;
		}
	: {}) &
	(TStateValue extends Record<any, any>
		? {
				/**
			 * Assign a partial state to the store using Immer
			 * @param state The partial state to assign
			 * @example ts
			 user.assign({ name: 'John Doe' })
			 */
				assign: (partial: Partial<TStateValue>) => void;
			}
		: {}) & {
		/**
		 * @returns The current state of the entire store
		 * @note This does not subscribe to changes in the store
		 */
		get: <
			TSelector extends (state: TStateValue) => unknown = (
				state: TStateValue
			) => TStateValue,
		>(
			selector?: TSelector
		) => ReadonlyState<TSelector, TStateValue>;
		/**
		 * Set a new state for the entire store using Immer
		 * @param fn A function that mutates the current state
		 * @param actionName An optional name for the action
		 *
		 * @NOTE Current if the state is an array or object, then the function should mutate the state directly. If the state is a primitive value, then the function should return the new value.
		 *
		 */
		set: (
			newValueOrFn:
				| TStateValue
				| ((
						prev: TStateValue
				  ) => TStateValue extends object ? void : TStateValue)
		) => void;
		/**
		 * @returns A Reactive version of the store
		 */
		use: <
			TSelector extends (state: TStateValue) => unknown = (
				state: TStateValue
			) => TStateValue,
		>(
			selector?: TSelector,
			equalityFn?: EqualityChecker<TStateValue>
		) => ReadonlyState<TSelector, TStateValue>;
		/**
		 * Subscribe to changes in the store
		 * @param callback A callback that is called whenever the store changes
		 * @returns A function to unsubscribe from the store
		 */
		onChange: (
			callback: (value: TStateValue, prevValue: TStateValue) => void,
			options?: OnChangeOptions<TStateValue>
		) => UnsubscribeFn;
	} & /**
	 * Using this & Simplify<{}> does not change the types in any way, it's just a weird work around that I found that changes how the types are displayed. Instead of showing the entire type on hover, it just shows the name of the type - making it much easier to read.
	 */
	Simplify<{}>;

export type UnsubscribeFn = () => void;

export type OnChangeOptions<TState> = {
	/**
	 * If set to true, the callback will be called immediately with the current state
	 */
	fireImmediately?: boolean;

	/**
	 * Custom equality function to compare the previous and new state
	 *
	 * first argument is the new state, second argument is the prev state
	 *
	 * if the function returns true, the callback will NOT be called;
	 * if it returns false, the callback will be called
	 *
	 * @default shallow (from zustand)
	 *
	 */
	equalityChecker?: EqualityChecker<TState>;

	/**
	 * Dependencies to trigger the callback when they're changed
	 *
	 * can be an array of keys or a function that takens in the object and returns the values to subscribe to
	 *
	 * this allows you to only subscribe to a subset of child values changes.
	 *
	 * @note non object values cannot use the deps option. If you need to subscribe to non-object value and another value, then call onChange on a parent object and then use the deps option to subscribe to both values.
	 *
	 */
	deps?: TState extends object
		? Partial<keyof TState>[] | ((state: TState) => any)
		: never;
};
