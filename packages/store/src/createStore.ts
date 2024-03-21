/* eslint-disable prettier/prettier */
import { enableMapSet, setAutoFreeze } from 'immer';
import { createTrackedSelector } from 'react-tracked';
import {
  devtools as devtoolsMiddleware,
  persist as persistMiddleware,
} from 'zustand/middleware';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { createStore as createVanillaStore } from 'zustand/vanilla';

import { immerMiddleware } from './middlewares/immer.middleware';
import {
  ImmerStoreApi,
  MergeState,
  SetImmerState,
  State,
  StateActions,
  StateGetters,
  StoreApi,
  UseImmerStore,
} from './types';
import { CreateStoreOptions } from './types/CreateStoreOptions';
import { generateStateActions } from './utils/generateStateActions';
import { generateStateGetSelectors } from './utils/generateStateGetSelectors';
import { generateStateHookSelectors } from './utils/generateStateHookSelectors';
import { generateStateTrackedHooksSelectors } from './utils/generateStateTrackedHooksSelectors';
import { pipe } from './utils/pipe';
import { storeFactory } from './utils/storeFactory';

import type { StateCreator } from 'zustand';

export const createStore =
  <TName extends string>(name: TName) =>
  <T extends State>(
    initialState: T,
    options: CreateStoreOptions<T> = {}
  ): StoreApi<TName, T, StateActions<T>> => {
    const {
      middlewares: _middlewares = [],
      devtools,
      persist,
      immer,
    } = options;

    setAutoFreeze(immer?.enabledAutoFreeze ?? false);
    if (immer?.enableMapSet) {
      enableMapSet();
    }

    const middlewares: any[] = [immerMiddleware, ..._middlewares];

    if (persist?.enabled) {
      const opts = {
        ...persist,
        name: persist.name ?? name,
      };

      middlewares.push((config: any) => persistMiddleware(config, opts));
    }

    if (devtools?.enabled) {
      middlewares.push((config: any) =>
        devtoolsMiddleware(config, { ...devtools, name })
      );
    }

    middlewares.push(createVanillaStore);

    // @ts-ignore
    const pipeMiddlewares = (createState: StateCreator<T, SetImmerState<T>>) =>
      pipe(createState as any, ...middlewares) as ImmerStoreApi<T>;

    const store = pipeMiddlewares(() => initialState);
    const useStore = ((selector, equalityFn) =>
      useStoreWithEqualityFn(
        store as any,
        selector as any,
        equalityFn as any
      )) as UseImmerStore<T>;

    const stateActions = generateStateActions(store, name);

    const mergeState: MergeState<T> = (state, actionName) => {
      store.setState(
        (draft) => {
          Object.assign(draft as any, state);
        },
        actionName || `@@${name}/mergeState`
      );
    };

    const setState: SetImmerState<T> = (fn, actionName) => {
      store.setState(fn, actionName || `@@${name}/setState`);
    };

    const hookSelectors = generateStateHookSelectors(useStore, store);
    const getterSelectors = generateStateGetSelectors(store);

    const useTrackedStore = createTrackedSelector(useStore);
    const trackedHooksSelectors = generateStateTrackedHooksSelectors(
      useTrackedStore,
      store
    );

    const api = {
      get: {
        state: store.getState,
        ...getterSelectors,
      } as StateGetters<T>,
      name,
      set: {
        state: setState,
        mergeState,
        ...stateActions,
      } as StateActions<T>,
      store,
      use: hookSelectors,
      useTracked: trackedHooksSelectors,
      useStore,
      useTrackedStore,
      extendSelectors: () => api as any,
      extendActions: () => api as any,
    };

    return storeFactory(api) as StoreApi<TName, T, StateActions<T>>;
  };

// Alias {@link createStore}
export const createZustandStore = createStore;
