/* eslint-disable no-unused-vars */
/* eslint-disable prettier/prettier */
import { Draft } from 'immer';
import React from 'react';
import { StoreApi as RawStoreApi, UseBoundStore } from 'zustand';

export type State = unknown;

export type InnerStoreMethods<TState> = {
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
	 * @returns A Reactive version of the entire store
	 * @note AVOID using this in most cases as it will cause the component to re-render on every change in the store.
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

export type MainStoreMethods<TState> = InnerStoreMethods<TState> &
	(TState extends object
		? { [TKey in keyof TState]: MainStoreMethods<TState[TKey]> }
		: {});

export type StoreApi<
	TName extends string,
	TState extends State = {},
	TExtendedProps extends Record<string, any> = {},
> = MainStoreMethods<TState> &
	TExtendedProps & {
		immerStoreApi: ImmerStoreApi<TState>;
		/**
		 * The name of the store instance, useful for debugging and devtools
		 */
		storeName: TName;

		createInstance: (
			initialValue: Partial<TState>
		) => StoreApi<TName, TState, TExtendedProps>;

		/**
		 * Extends the store with new actions and selectors
		 *
		 * @param builder A function that extends the store with new actions and selectors
		 */
		extend<
			TComputedBuilder extends ExtendBuilder<TName, TState, TExtendedProps>,
		>(
			builder: TComputedBuilder
		): StoreApi<TName, TState, TExtendedProps & ReturnType<TComputedBuilder>>;
	};

type Archive<TName extends string, TState, TExtendedProps extends object> = { 
	/**
	 * A provider for the store that allows you to access scoped state and actions using useLocalStore
	 * @param children The children components that will have access to the scoped store
	 * @param initialValue The initial value of the scoped store (partial state)
	 */
	Provider: React.FC<{
		children: React.ReactNode;
		initialValue: Partial<TState>;
	}>;

	/**
	 *
	 * @returns A local store that is scoped to the children components of the LocalProvider
	 */
	useStore: () => Omit<
		StoreApi<TName, TState, TExtendedProps>,
		'LocalProvider' | 'useLocalStore'
	>;
};

export type ExtendBuilder<
	TName extends string,
	T extends State,
	TExtendedProps extends Record<string, any>,
> = (
	store: StoreApi<TName, T, TExtendedProps>
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
