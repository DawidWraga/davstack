/* eslint-disable prettier/prettier */
import React from 'react';
import { enableMapSet, setAutoFreeze } from 'immer';
import { createTrackedSelector } from 'react-tracked';
import {
  devtools as devtoolsMiddleware,
  persist as persistMiddleware,
} from 'zustand/middleware';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { createStore as createVanillaStore } from 'zustand/vanilla';

import { AltStoreApi, DynamicStateMethods } from './alt-types';
import { immerMiddleware } from './middlewares/immer.middleware';
import {
  ImmerStoreApi,
  MergeState,
  SetImmerState,
  State,
  StateActions,
  StateGetters,
  UseImmerStore,
} from './types';
import { CreateStoreOptions } from './types/CreateStoreOptions';
import { altStoreFactory } from './utils/altStoreFactory';
import { generateStateActions } from './utils/generateStateActions';
import { generateStateGetSelectors } from './utils/generateStateGetSelectors';
import { generateStateHookSelectors } from './utils/generateStateHookSelectors';
import { generateStateTrackedHooksSelectors } from './utils/generateStateTrackedHooksSelectors';
import { pipe } from './utils/pipe';
import { storeFactory } from './utils/storeFactory';

import type { StateCreator } from 'zustand';

const createInnerApi = <TName extends string, T extends Record<string, any>>(
  store: ImmerStoreApi<T>,
  name: TName,
  initialState: T
  // ): Omit<AltStoreApi<TName, T, {}>, 'useLocal'> => {
) => {
  const useStore = ((selector, equalityFn) =>
    useStoreWithEqualityFn(
      store as any,
      selector as any,
      equalityFn as any
    )) as UseImmerStore<T>;

  const setState: SetImmerState<T> = (fn, actionName) => {
    store.setState(fn, actionName || `@@${name}/setState`);
  };

  const stateActions = generateStateActions(store, name);
  const hookSelectors = generateStateHookSelectors(useStore, store);
  const getterSelectors = generateStateGetSelectors(store);
  const useTrackedStore = createTrackedSelector(useStore);
  const trackedHooksSelectors = generateStateTrackedHooksSelectors(
    useTrackedStore,
    store
  );

  const innerSelectors = Object.fromEntries(
    Object.entries(initialState).map(([key, value]) => {
      return [
        key,
        {
          get: () => getterSelectors[key](),
          // @ts-expect-error TODO: fix this
          set: (...args: any[]) => stateActions[key](...args),
          use: (...args: any[]) => hookSelectors[key](...args),
          useTracked: (...args: any[]) => trackedHooksSelectors[key](...args),
        },
      ];
    })
  ) as DynamicStateMethods<T>;

  const assign: MergeState<T> = (state, actionName) => {
    store.setState(
      (draft) => {
        Object.assign(draft as any, state);
      },
      actionName || `@@${name}/assign`
    );
  };

  const api = {
    ...innerSelectors,
    store,
    storeName: name,
    withComputed: () => api as any,
    set: setState,
    get: store.getState,
    use: useStore,
    useTracked: useTrackedStore,
    assign,
  };

  return api;

  // return altStoreFactory(api) as Omit<AltStoreApi<TName, T, {}>, 'useLocal'>;
};

export const createAltStore =
  <TName extends string>(name: TName) =>
  <T extends State>(
    initialState: T,
    options: CreateStoreOptions<T> = {}
  ): AltStoreApi<TName, T, {}> => {
    const {
      middlewares: _middlewares = [],
      devtools,
      persist,
      immer,
    } = options;

    //------  Set up immer & middlewares -----
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

    // ----- Define methods -----

    const LocalStoreContext = React.createContext<any>(null);

    const api = {
      ...createInnerApi(
        store as ImmerStoreApi<Record<string, any>>,
        name,
        initialState as Record<string, any>
      ),
      // create all this lazly when withLocalProvider is called
      // this ensures that the api passed in contains all the withComputed methods (assuming you call withComputed before withLocalProvider)
      // when withLocalProvider is called, then add useLocalStore and LocalProvider
      // alternatively, could add LocalProvider but juse reuse the existing use() method to get the local store (force local only?)
      LocalProvider: ({
        children,
        initialValue: localInitialValue = {},
      }: {
        initialValue?: Partial<T>;
        children: React.ReactNode;
      }) => {
        console.log('PROVIDER localInitialValue', localInitialValue);
        console.log('PROVIDER initialState', initialState);
        // const LocalStoreContext = React.createContext<any>(null); // Declare missing LocalStoreContext variable

        const localInitialMerged = {
          // @ts-expect-error
          ...initialState,
          ...localInitialValue,
        };

        const localApi = createInnerApi(
          pipeMiddlewares(() => localInitialMerged) as ImmerStoreApi<
            Record<string, any>
          >,
          'inner_' + name,

          localInitialMerged as Record<string, any>
        );

        console.log('PROVIDER localApi', localApi.get());

        return (
          <LocalStoreContext.Provider
            // value={{ ...api }}
            value={{ ...api, ...localApi }}
          >
            {children}
          </LocalStoreContext.Provider>
        );
      },
      useLocalStore: (): Omit<
        AltStoreApi<TName, T, {}>,
        'useLocalStore' | 'LocalProvider'
      > => {
        const localStore = React.useContext(LocalStoreContext);
        console.log('localStore valuse:', localStore.get());

        if (localStore) {
          return localStore;
        }
        // @ts-expect-error
        return null;
      },
    };

    // @ts-expect-error
    return altStoreFactory(api) as AltStoreApi<TName, T, StateActions<T>>;
  };

// Alias {@link createStore}
export const createZustandStore = createAltStore;
