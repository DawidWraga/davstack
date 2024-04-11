/* eslint-disable no-unused-vars */
/* eslint-disable prettier/prettier */
import { Draft } from 'immer';
import React from 'react';
import { StoreApi as RawStoreApi, UseBoundStore } from 'zustand';

export type State = unknown;

export type StoreMethods<TState> = {
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
		 * Assign a partial state to the store using Immer
		 * @param state The partial state to assign
		 * @example ts
		 user.assign({ name: 'John Doe' })
		 */
	assign: (partial: Partial<TState>) => void;
};

export type NestedStoreMethods<TState> = StoreMethods<TState> &
	(TState extends object
		? { [TKey in keyof TState]: NestedStoreMethods<TState[TKey]> }
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
> = NestedStoreMethods<TState> &
	TExtendedProps & {
		_: StoreInternals<TState, TExtendedProps>;

		/**
		 * Extends the store with new actions and selectors
		 *
		 * @param builder A function that extends the store with new actions and selectors
		 */
		extend<TBuilder extends ExtendBuilder<TState, TExtendedProps>>(
			builder: TBuilder
		): StoreApi<TState, TExtendedProps & ReturnType<TBuilder>>;
	};

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
