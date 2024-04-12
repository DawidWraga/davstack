/* eslint-disable no-unused-vars */
/* eslint-disable prettier/prettier */
import { EqualityChecker } from '../types';

export type State = unknown;

/**
 * the TState is recursively narrowed down to each property, but we need access to the full state to correctly type the onChange additionalDeps, so we need to pass the full state type as TFullState
 */
export type StoreMethods<TState, TFullState> = {
	/**
	 * @returns The current state of the entire store
	 * @note This does not subscribe to changes in the store
	 */
	get: () => TState;
	/**
		 * Set a new state for the entire store using Immer
		 * @param fn A function that mutates the current state
		 * @param actionName An optional name for the action
		 * 
		 * @NOTE Current if using nested.set callback then it just RETURN the value, as using the regular immer `draft = value` doesn't work as expected
		 * 
		 * @example ts
		
		 user.set((draft) => {
		   draft.name = 'John Doe'
		 })

		 */
	set: (newValueOrFn: TState | ((prev: TState) => TState | void)) => void;
	/**
	 * @returns A Reactive version of the store
	 */
	use: () => TState;

	/**
	 * Subscribe to changes in the store
	 * @param callback A callback that is called whenever the store changes
	 * @returns A function to unsubscribe from the store
	 */
	onChange: (
		callback: (value: TState, prevValue: TState) => void,
		options?: OnChangeOptions<TFullState>
	) => void;

	/**
		 * Assign a partial state to the store using Immer
		 * @param state The partial state to assign
		 * @example ts
		 user.assign({ name: 'John Doe' })
		 */
	assign: (partial: Partial<TState>) => void;
};

export type OnChangeOptions<TState> = {
	/**
	 * If set to true, the callback will be called immediately with the current state
	 */
	fireImmediately?: boolean;

	equalityFn?: EqualityChecker<TState>;

	additionalDeps?: Partial<keyof TState>[];

	/**
	 *  custom fn for defining the subscription dependencies
	 */
	customSelector?: (state: TState) => any;
};

export type NestedStoreMethods<TState, TFullState = object> = StoreMethods<
	TState,
	TFullState
> &
	(TState extends object
		? { [TKey in keyof TState]: NestedStoreMethods<TState[TKey], TFullState> }
		: {});

export type RecursiveNestedStoreMethods<TState, TSlice> = StoreMethods<
	TSlice,
	TState
> &
	(TState extends object
		? {
				[TKey in keyof TSlice]: RecursiveNestedStoreMethods<
					TState,
					TSlice[TKey]
				>;
			}
		: {});
