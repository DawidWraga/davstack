/* eslint-disable no-unused-vars */
/* eslint-disable prettier/prettier */
import { Draft } from 'immer';
import React from 'react';
import { StoreApi as RawStoreApi, UseBoundStore } from 'zustand';
import {
	ComputedBuilder,
	ComputedProps,
	ComputedMethods,
} from './utils/create-computed-methods';

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

export interface StoreInternals<
	TState extends State = {},
	TExtendedProps extends Record<string, any> = {},
> {
	createInstance: (
		initialValue: Partial<TState>
	) => StoreApi<TState, TExtendedProps>;
	name: string;
	extensions: Array<(store: StoreApi<TState>) => Record<string, any>>;
	applyExtensions: (store: StoreApi<TState>) => void;
	createInnerStore: (initialState: TState) => ImmerStoreApi<TState>;
	innerStore: ImmerStoreApi<TState>;
}

export type StoreApi<
	TState extends State = {},
	TExtendedProps extends Record<string, any> = {},
> = RecursiveNestedStoreMethods<TState, TState> &
	TExtendedProps & {
		_: StoreInternals<TState, TExtendedProps>;

		/**
		 * Extends the store
		 *
		 * @param builder a callback that receives the store and returns an object with the new methods
		 */
		extend<TBuilder extends ExtendBuilder<TState, TExtendedProps>>(
			builder: TBuilder
		): StoreApi<TState, TExtendedProps & ReturnType<TBuilder>>;
		/**
		 * Extends the store
		 * @param builder a callback that receives the store and returns an object with the new methods
		 */
		actions<TBuilder extends ExtendBuilder<TState, TExtendedProps>>(
			builder: TBuilder
		): StoreApi<TState, TExtendedProps & ReturnType<TBuilder>>;

		computed<
			TComputedProps extends ComputedProps,
			TBuilder extends ComputedBuilder<
				StoreApi<TState, TExtendedProps>,
				TComputedProps
			>,
		>(
			builder: TBuilder
		): StoreApi<TState, TExtendedProps & ComputedMethods<ReturnType<TBuilder>>>;

		effect<TBuilder extends EffectBuilder<TState>>(
			builder: TBuilder
		): StoreApi<TState, TExtendedProps>;
	};

// TODO: decide if we want to keep this
export type EffectBuilder<TState extends State> = (
	store: StoreApi<TState>
) => Partial<
	Record<
		keyof TState,
		(value: TState[keyof TState], prevValue: TState[keyof TState]) => void
	>
>;

// export type ComputedBuilder<
// 	T extends State,
// 	TComputedProps extends Record<string, any>,
// > = (store: T) => TComputedProps;

export type ExtendBuilder<
	T extends State,
	TExtendedProps extends Record<string, any>,
> = (
	store: StoreApi<T, TExtendedProps>
) => Record<string, (...args: any[]) => any>;

export type Simplify<T> = T extends any[] | Date
	? T
	: { [K in keyof T]: T[K] } & {};

export type EqualityChecker<T> = (state: T, newState: T) => boolean;

export type SetImmerState<T> = (
	fnOrNewValue: ((draft: Draft<T>) => void) | Draft<T>,
	actionName?: string
) => void;

export interface ImmerStoreApi<T extends State>
	extends Omit<RawStoreApi<T>, 'setState'> {
	setState: SetImmerState<T>;
}
export interface UseImmerStore<T extends State>
	extends Omit<UseBoundStore<RawStoreApi<T>>, 'setState'> {
	(): T;

	<U>(selector: (s: T) => U, equalityFn?: EqualityChecker<U>): U;

	setState: SetImmerState<T>;
}
