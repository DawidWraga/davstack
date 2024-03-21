/* eslint-disable prettier/prettier */
import { Draft } from 'immer';
import { StoreApi as RawStoreApi, UseBoundStore } from 'zustand';
import { NamedSet } from 'zustand/middleware';
import { GetState, StateSelector, StoreApi } from 'zustand/vanilla';

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
export type DynamicStateMethods<T> = {
  [P in keyof T]: {
    get: () => T[P];
    set: (value: T[P]) => void;
    use: () => T[P];
    useTracked: () => T[P];
  };
};

// ALT TYPE
export type AltStoreApi<
  TName extends string,
  T extends State = {},
  TComputed extends Record<string, any> = {},
> = DynamicStateMethods<T> &
  TComputed & {
    store: ImmerStoreApi<T>;
    storeName: TName;
    // get: StoreApiGet<T, TSelectors>;
    get: StoreApi<T>['getState'];
    // set: StoreApiSet<TActions>;
    set: SetImmerState<T>;
    // use: StoreApiUse<T, TSelectors>;
    use: UseImmerStore<T>;
    // useStore: UseImmerStore<T>;
    // useTracked: StoreApiUseTracked<T, TSelectors>;
    useTracked: () => T;

    useLocalStore: () => Omit<
      AltStoreApi<TName, T, TComputed>,
      'useLocalStore'
    >;

    LocalProvider: React.FC<{
      children: React.ReactNode;
      initialValue: Partial<T>;
    }>;

    // createLocalStore: () => AltStoreApi<TName, T, TComputed> & {
    //   LocalProvider: React.FC<{
    //     children: React.ReactNode;
    //     initialValue: Partial<T>;
    //   }>;
    // };
    // useTrackedStore: () => T;

    assign: MergeState<T>;

    withComputed<TComputedBuilder extends ComputedBuilder<TName, T, TComputed>>(
      builder: TComputedBuilder
    ): AltStoreApi<TName, T, TComputed & ReturnType<TComputedBuilder>>;
  };

export type ComputedBuilder<
  TName extends string,
  T extends State,
  TComputed extends Record<string, any>,
> = (
  store: AltStoreApi<TName, T, TComputed>
) => Record<string, (...args: any[]) => any>;

export type Simplify<T> = T extends any[] | Date
  ? T
  : { [K in keyof T]: T[K] } & {};

export type State = unknown;
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
