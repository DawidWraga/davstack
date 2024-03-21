/* eslint-disable prettier/prettier */
import { Draft } from 'immer';
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

// ALT TYPE
export type DynamicStateMethods<TState> = {
	[TKey in keyof TState]: {
		get: () => TState[TKey];
		set: (newValue: TState[TKey]) => void;
		use: () => TState[TKey];
		useTracked: () => TState[TKey];
	};
};

// ALT TYPE
export type StoreApi<
	TName extends string,
	T extends State = {},
	TExtendedProps extends Record<string, any> = {},
> = DynamicStateMethods<T> &
	TExtendedProps & {
		immerStoreApi: ImmerStoreApi<T>;
		storeName: TName;
		// get: StoreApiGet<T, TSelectors>;
		get: ZustandStoreApi<T>['getState'];
		// set: StoreApiSet<TActions>;
		set: SetImmerState<T>;
		// use: StoreApiUse<T, TSelectors>;
		use: UseImmerStore<T>;
		// useStore: UseImmerStore<T>;
		// useTracked: StoreApiUseTracked<T, TSelectors>;
		useTracked: () => T;

		LocalProvider: React.FC<{
			children: React.ReactNode;
			initialValue: Partial<T>;
		}>;
		useLocalStore: () => Omit<StoreApi<TName, T, TExtendedProps>, 'withLocal'>;

		assign: MergeState<T>;

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
