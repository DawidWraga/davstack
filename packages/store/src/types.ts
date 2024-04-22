/* eslint-disable no-unused-vars */

import { Draft } from 'immer';
import { StoreApi as RawStoreApi, UseBoundStore } from 'zustand';
import { NestedStoreMethods, UnsubscribeFn } from './types/store-methods';
import {
	ComputedBuilder,
	ComputedMethods,
	ComputedProps,
} from './utils/create-computed-methods';
import { StoreOptions } from './types/CreateStoreOptions';

export type State = unknown;

export interface StoreDef<
	TState extends State = {},
	TExtendedProps extends Record<string, any> = {},
> {
	name: string;
	extensions: Array<(store: StoreApi<TState>) => Record<string, any>>;
	options: StoreOptions<TState>;
	initialState: TState | undefined;
}

export type StoreBuilderMethods<
	TState extends State,
	TExtendedProps extends Record<string, any> = {},
	TInput extends Record<string, any> = {},
> = {
	_def: StoreDef<TState, TExtendedProps>;

	identify: (newName: string) => StoreApi<TState, TExtendedProps, TInput>;

	/**
	 *
	 * @param enabled  enable or disable devtools
	 * @default true
	 *
	 */
	devtools: (enabled?: boolean) => StoreApi<TState, TExtendedProps, TInput>;

	input: <TNewInput extends Record<string, any>>(
		initialInput: TNewInput
	) => StoreApi<TState, TExtendedProps, TNewInput>;
	options: (
		options: StoreOptions<TState>
	) => StoreApi<TState, TExtendedProps, TInput>;
	state: <TNewState>(
		initialValue: TNewState
	) => StoreApi<TNewState, TExtendedProps, TInput>;

	/**
	 * Creates a new store with the given initial value
	 *
	 * @param initialValue the initial value of the store
	 */

	create: (
		initialValue?: Partial<TState> & TInput
	) => StoreApi<TState, TExtendedProps, TInput>;
	// ) => NestedStoreMethods<TState> & Simplify<TExtendedProps & TInput>;
	// ) => StoreApi<TState, TExtendedProps, TInput>;

	/**
	 * Extends the store
	 *
	 * @param builder a callback that receives the store and returns an object with the new methods
	 */
	extend<
		TBuilder extends ExtendBuilder<StoreApi<TState, TExtendedProps, TInput>>,
	>(
		builder: TBuilder
	): StoreApi<TState, TExtendedProps & ReturnType<TBuilder>, TInput>;
	/**
	 * Extends the store
	 * @param builder a callback that receives the store and returns an object with the new methods
	 */
	actions<
		TBuilder extends ExtendBuilder<StoreApi<TState, TExtendedProps, TInput>>,
	>(
		builder: TBuilder
	): StoreApi<TState, TExtendedProps & ReturnType<TBuilder>, TInput>;

	computed<
		TComputedProps extends ComputedProps,
		TBuilder extends ComputedBuilder<
			StoreApi<TState, TExtendedProps, TInput>,
			TComputedProps
		>,
	>(
		builder: TBuilder
	): StoreApi<
		TState,
		TExtendedProps & ComputedMethods<ReturnType<TBuilder>>,
		TInput
	>;

	effects<
		TBuilder extends EffectBuilder<StoreApi<TState, TExtendedProps, TInput>>,
	>(
		builder: TBuilder
	): StoreApi<
		TState,
		TExtendedProps & EffectMethods<ReturnType<TBuilder>>,
		TInput
	>;
};

export type StoreApi<
	TState extends State = {},
	TExtendedProps extends Record<string, any> = {},
	TInput extends Record<string, any> = {},
> = StoreBuilderMethods<TState, TExtendedProps, TInput> &
	NestedStoreMethods<TState> &
	Simplify<TExtendedProps & TInput>;

export type EffectBuilder<TStore extends StoreApi<any, any, any>> = (
	store: TStore
) => Record<string, UnsubscribeFn>;

export type EffectMethods<TMethods> = {
	_effects: TMethods;
	subscribeToEffects: () => void;
	unsubscribeFromEffects: () => void;
};

export type ExtendBuilder<TStore extends StoreApi<any, any, any>> = (
	store: TStore
) => Record<string, any>;

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
