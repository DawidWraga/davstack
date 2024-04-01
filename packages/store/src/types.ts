/* eslint-disable prettier/prettier */
import { Draft } from 'immer';
import React from 'react';
import { StoreApi as RawStoreApi, UseBoundStore } from 'zustand';
import { NamedSet } from 'zustand/middleware';
import {
	GetState,
	StateSelector,
	StoreApi as ZustandStoreApi,
} from 'zustand/vanilla';

export type StoreApiGet<
	T extends State = {},
	TSelectors = {},
> = StateGetters<T> & TSelectors;
export type StoreApiUse<T extends State = {}, TSelectors = {}> = GetRecord<T> &
	TSelectors;
export type StoreApiUseTracked<
	T extends State = {},
	TSelectors = {},
> = GetRecord<T> & TSelectors;
export type StoreApiSet<TActions = {}> = TActions;

export type DynamicStateMethods<TState> = {
	[TKey in keyof TState]: {
		get: () => TState[TKey];

		set: (
			newValueOrFn: TState[TKey] | ((prev: TState[TKey]) => TState[TKey])
		) => void;
		use: () => TState[TKey];
		useTracked: () => TState[TKey];
	};
};

export type StoreApi<
	TName extends string,
	T extends State = {},
	TExtendedProps extends Record<string, any> = {},
> = DynamicStateMethods<T> &
	TExtendedProps & {
		immerStoreApi: ImmerStoreApi<T>;
		/**
		 * The name of the store instance, useful for debugging and devtools
		 */
		storeName: TName;
		/**
		 * @returns The current state of the entire store
		 * @note This does not subscribe to changes in the store
		 */
		get: ZustandStoreApi<T>['getState'];
		/**
		 * Set a new state for the entire store using Immer
		 * @param fn A function that mutates the current state
		 * @param actionName An optional name for the action
		 * @example ts
		
		 user.set((draft) => {
		   draft.name = 'John Doe'
		 })

		 */
		set: SetImmerState<T>;
		/**
		 * Assign a partial state to the store using Immer
		 * @param state The partial state to assign
		 * @example ts
		 user.assign({ name: 'John Doe' })
		 */
		assign: MergeState<T>;
		/**
		 * @returns A Reactive version of the entire store
		 * @note AVOID using this in most cases as it will cause the component to re-render on every change in the store.
		 */

		use: UseImmerStore<T>;
		/**
		 * @returns A reactive proxy of version of the entire store
		 */
		useTracked: () => T;

		/**
		 * A provider for the store that allows you to access scoped state and actions using useLocalStore
		 * @param children The children components that will have access to the scoped store
		 * @param initialValue The initial value of the scoped store (partial state)
		 */
		LocalProvider: React.FC<{
			children: React.ReactNode;
			initialValue: Partial<T>;
		}>;

		/**
		 *
		 * @returns A local store that is scoped to the children components of the LocalProvider
		 */
		useLocalStore: () => Omit<
			StoreApi<TName, T, TExtendedProps>,
			'LocalProvider' | 'useLocalStore'
		>;

		/**
		 * Extends the store with new actions and selectors
		 *
		 * @param builder A function that extends the store with new actions and selectors
		 */
		extend<TComputedBuilder extends ExtendBuilder<TName, T, TExtendedProps>>(
			builder: TComputedBuilder
		): StoreApi<TName, T, TExtendedProps & ReturnType<TComputedBuilder>>;
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

export type State = Record<string, any>;
export type EqualityChecker<T> = (state: T, newState: T) => boolean;

export type MergeState<T extends State> = (
	state: Partial<T>,
	actionName?: string
) => void;

export type StateActions<T extends State> = SetRecord<T> & {
	state: SetImmerState<T>;
	mergeState: MergeState<T>;
};
export type StateGetters<T extends State> = GetRecord<T> & {
	state: GetState<T>;
};

export type SelectorRecord<T> = Record<string, (state: T) => any>;

// export type SelectorBuilder<
//   TName extends string,
//   T extends State,
//   TActions = {},
//   TSelectors = {},
// > = (
//   state: T,
//   get: StoreApiGet<T, TSelectors>,
//   api: AltStoreApi<TName, T, TActions, TSelectors>
// ) => Record<string, (...args: any[]) => any>;

// export type ActionBuilder<
//   TName extends string,
//   T extends State,
//   TActions = {},
//   TSelectors = {},
// > = (
//   set: StoreApiSet<TActions>,
//   get: StoreApiGet<T, TSelectors>,
//   api: AltStoreApi<TName, T, TActions, TSelectors>
// ) => any;

export type SetImmerState<T> = (
	fn: (draft: Draft<T>) => void,
	actionName?: string
) => void;

export type StateCreatorWithDevtools<
	T extends State,
	CustomSetState = NamedSet<T>,
	CustomGetState = GetState<T>,
	CustomStoreApi extends RawStoreApi<T> = RawStoreApi<T>,
> = (set: CustomSetState, get: CustomGetState, api: CustomStoreApi) => T;

export interface ImmerStoreApi<T extends State>
	extends Omit<RawStoreApi<T>, 'setState'> {
	setState: SetImmerState<T>;
}

export interface UseImmerStore<T extends State>
	extends Omit<UseBoundStore<RawStoreApi<T>>, 'setState'> {
	(): T;

	<U>(selector: StateSelector<T, U>, equalityFn?: EqualityChecker<U>): U;

	setState: SetImmerState<T>;
}

export type GetRecord<O> = {
	[K in keyof O]: (equalityFn?: EqualityChecker<O[K]>) => O[K];
};
export type SetRecord<O> = {
	[K in keyof O]: (value: O[K]) => void;
};

// export type UseRecord<O> = {
//   [K in keyof O as `use${Capitalize<string & K>}`]: () => O[K];
// };
// export type GetRecord<O> = {
//   [K in keyof O as `get${Capitalize<string & K>}`]: () => O[K];
// };
// export type SetRecord<O> = {
//   [K in keyof O as `set${Capitalize<string & K>}`]: (value: O[K]) => void;
// };
