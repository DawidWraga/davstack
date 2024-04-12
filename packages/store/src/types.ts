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
import { RecursiveNestedStoreMethods } from './types/store-methods';

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
