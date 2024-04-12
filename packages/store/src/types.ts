/* eslint-disable no-unused-vars */

import { Draft } from 'immer';
import { StoreApi as RawStoreApi, UseBoundStore } from 'zustand';
import { NestedStoreMethods, UnsubscribeFn } from './types/store-methods';
import {
	ComputedBuilder,
	ComputedMethods,
	ComputedProps,
} from './utils/create-computed-methods';

export type State = unknown;

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

		// _effects: EffectMethods<{}>;

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

		effects<TBuilder extends EffectBuilder<TState, TExtendedProps>>(
			builder: TBuilder
		): StoreApi<TState, TExtendedProps & EffectMethods<ReturnType<TBuilder>>>;
	};

export type EffectBuilder<
	T extends State,
	TExtendedProps extends Record<string, any>,
> = (store: StoreApi<T, TExtendedProps>) => Record<string, UnsubscribeFn>;

export type EffectMethods<TMethods> = {
	_effects: TMethods;
	subscribeToEffects: () => void;
	unsubscribeFromEffects: () => void;
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
