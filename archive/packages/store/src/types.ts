/* eslint-disable no-unused-vars */

import {
	ComputedBuilder,
	ComputedMethods,
	ComputedProps,
} from './create-computed/create-computed-methods';
import { State, UnsubscribeFn } from './create-state-methods/state.types';
import { StoreOptions } from './create-store/create-store-options';

export type StateValue = unknown;

export type { StoreApi as ZustandStoreApi } from 'zustand';

export interface StoreDef<TStateValue extends StateValue = {}> {
	name: string;
	extensions: Array<(store: StoreApi<TStateValue>) => Record<string, any>>;
	options: StoreOptions<TStateValue>;
	initialState: TStateValue | undefined;
}

export type StoreBuilderMethods<
	TState extends StateValue,
	TExtendedProps extends Record<string, any> = {},
> = {
	_def: StoreDef<TState>;

	options: (options: StoreOptions<TState>) => StoreApi<TState, TExtendedProps>;
	state: <TNewState>(
		initialState: TNewState
	) => StoreApi<TNewState, TExtendedProps>;

	/**
	 * Creates a new store with the given initial value
	 *
	 * @param initialState the initial value of the store
	 */

	create: (initialState?: Partial<TState>) => StoreApi<TState, TExtendedProps>;

	/**
	 * Extends the store
	 *
	 * @param builder a callback that receives the store and returns an object with the new methods
	 */
	extend<TBuilder extends ExtendBuilder<StoreApi<TState, TExtendedProps>>>(
		builder: TBuilder
	): StoreApi<TState, TExtendedProps & ReturnType<TBuilder>>;
	/**
	 * Extends the store
	 * @param builder a callback that receives the store and returns an object with the new methods
	 */
	actions<TBuilder extends ExtendBuilder<StoreApi<TState, TExtendedProps>>>(
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

	effects<TBuilder extends EffectBuilder<StoreApi<TState, TExtendedProps>>>(
		builder: TBuilder
	): StoreApi<TState, TExtendedProps & EffectMethods<ReturnType<TBuilder>>>;
};

export type StoreApi<
	TState extends StateValue = {},
	TExtendedProps extends Record<string, any> = {},
> = StoreBuilderMethods<TState, TExtendedProps> &
	State<TState> &
	Simplify<TExtendedProps>;

export type EffectBuilder<TStore extends StoreApi<any, any>> = (
	store: TStore
) => Record<string, UnsubscribeFn>;

export type EffectDefs = Record<string, UnsubscribeFn>;

export type EffectMethods<TEffectDefs extends EffectDefs> = {
	_effects: TEffectDefs;
	subscribeToEffects: () => void;
	unsubscribeFromEffects: () => void;
};

export type ExtendBuilder<TStore extends StoreApi<any, any>> = (
	store: TStore
) => Record<string, any>;

export type Simplify<T> = T extends any[] | Date
	? T
	: { [K in keyof T]: T[K] } & {};

export type EqualityChecker<T> = (state: T, newState: T) => boolean;
