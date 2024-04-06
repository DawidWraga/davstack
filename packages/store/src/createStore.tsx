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
	DynamicStateMethods,
	ImmerStoreApi,
	MergeState,
	SetImmerState,
	State,
	StoreApi,
	UseImmerStore,
} from './types';
import { CreateStoreOptions } from './types/CreateStoreOptions';
import { generateStateActions, isFunction } from './utils/generateStateActions';
import { generateStateGetSelectors } from './utils/generateStateGetSelectors';
import { generateStateHookSelectors } from './utils/generateStateHookSelectors';
import { generateStateTrackedHooksSelectors } from './utils/generateStateTrackedHooksSelectors';
import { pipe } from './utils/pipe';

import React from 'react';
import type { StateCreator } from 'zustand';
export const createStore = <TState extends State, TName extends string>(
	initialState: TState,
	options: CreateStoreOptions<TState, TName> = {}
): StoreApi<TName, TState, {}> => {
	const { middlewares: _middlewares = [], devtools, persist, immer } = options;

	setAutoFreeze(immer?.enabledAutoFreeze ?? false);
	if (immer?.enableMapSet) {
		enableMapSet();
	}

	const name =
		options.name ??
		JSON.stringify(
			isObject(initialState) ? Object.keys(initialState) : initialState
		);

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

	/**
	 * Store the applied extensions to be applied later
	 * This allows us to ensure that the local store has the same extensions as the global store
	 */
	let extensions: Array<
		(store: StoreApi<TName, TState, {}>) => Record<string, any>
	> = [];

	const pipeMiddlewares = (
		// @ts-expect-error
		createState: StateCreator<TState, SetImmerState<TState>>
	) => pipe(createState as any, ...middlewares) as ImmerStoreApi<TState>;

	/**
	 * By extracting this logic we are able to recreate the store again in the LocalProvider
	 * Otherwise the localStore setters would actually set the global store
	 */
	const createInnerStore = (initialState: TState) => {
		const immerStoreApi = pipeMiddlewares(() => initialState);
		const useStore = ((selector, equalityFn) =>
			useStoreWithEqualityFn(
				immerStoreApi as any,
				selector as any,
				equalityFn as any
			)) as UseImmerStore<TState>;

		const setState: SetImmerState<TState> = (fnOrNewValue, actionName) => {
			immerStoreApi.setState(fnOrNewValue, actionName || `@@${name}/setState`);
			// console.log('SETTING STATE', { fnOrNewValue, actionName });
			// if (isFunction(fnOrNewValue)) {
			// 	immerStoreApi.setState(
			// 		fnOrNewValue,
			// 		actionName || `@@${name}/setState`
			// 	);
			// } else {
			// 	immerStoreApi.setState(
			// 		(draft) => {
			// 			console.log('SETTING STATE', { draft, fnOrNewValue });
			// 			draft = fnOrNewValue;
			// 			// if (isObject(fnOrNewValue)) {
			// 			// 	Object.assign(draft as object, fnOrNewValue);
			// 			// } else {
			// 			// }
			// 		},
			// 		actionName || `@@${name}/setState`
			// 	);
			// }
		};
		const useTrackedStore = createTrackedSelector(useStore);
		function generateInnerSelectors() {
			if (!isObject(initialState)) {
				return {};
			}

			type TStateButObject = TState extends object ? TState : never;

			const stateActions = generateStateActions<TStateButObject>(
				// @ts-expect-error
				immerStoreApi,
				name
			);
			const hookSelectors = generateStateHookSelectors<TStateButObject>(
				// @ts-expect-error
				useStore,
				immerStoreApi
			);
			const getterSelectors =
				// @ts-expect-error
				generateStateGetSelectors<TStateButObject>(immerStoreApi);

			const trackedHooksSelectors = generateStateTrackedHooksSelectors(
				useTrackedStore,
				immerStoreApi
			);

			const innerSelectors = Object.fromEntries(
				Object.entries(initialState).map(([key, value]: [string, any]) => {
					return [
						key,
						{
							// @ts-expect-error
							get: () => getterSelectors[key](),
							// @ts-expect-error TODO: fix this

							set: (...args: any[]) => stateActions[key](...args),
							// @ts-expect-error
							use: (...args: any[]) => hookSelectors[key](...args),
							useTracked: (...args: any[]) =>
								// @ts-expect-error
								trackedHooksSelectors[key](...args),
						},
					];
				})
			) as DynamicStateMethods<TStateButObject>;

			return innerSelectors;
		}

		const assign: MergeState<TState> = (state, actionName) => {
			immerStoreApi.setState(
				// if state is not, then just pass the value just like .set. Otherwise merge the state
				// @ts-expect-error
				isObject(initialState)
					? (draft) => {
							Object.assign(draft as any, state);
						}
					: state,

				actionName || `@@${name}/assign`
			);
		};

		return {
			...generateInnerSelectors(),
			immerStoreApi,
			storeName: name,
			set: setState,
			get: immerStoreApi.getState,
			use: useStore,
			useTracked: useTrackedStore,
			assign,
		};
	};

	const applyExtensions = (store: StoreApi<TName, TState, {}>) => {
		return extensions.reduce((acc, ext) => {
			// should avoid using spread operator here as it reduce + spread harms performance
			return Object.assign(acc, ext(acc));
		}, store);
	};
	const globalStore = createInnerStore(initialState);

	const LocalContext = React.createContext<StoreApi<TName, TState, {}> | null>(
		null
	);

	const LocalProvider = ({
		children,
		initialValue: localInitialValue = {},
	}: {
		initialValue?: Partial<TState>;
		children: React.ReactNode;
	}) => {
		// if is object then merge, otherwise use the localInitialValue and fallback to initialState
		const mergedInitialState = isObject(initialState)
			? {
					...initialState,
					...localInitialValue,
				}
			: ((localInitialValue ?? initialState) as TState);

		const localStore = createInnerStore(mergedInitialState);
		// @ts-expect-error
		const localStoreWithExtensions = applyExtensions(localStore);

		return (
			<LocalContext.Provider value={localStoreWithExtensions}>
				{children}
			</LocalContext.Provider>
		);
	};

	const useLocalStore = () => {
		const localStore = React.useContext(LocalContext);

		if (localStore) {
			return localStore;
		}

		throw new Error('useLocalStore must be used within a LocalProvider');
	};

	const api = {
		...globalStore,
		extend: <TNewExtendedProps extends Record<string, any>>(
			builder: (store: StoreApi<TName, TState, {}>) => TNewExtendedProps
		): StoreApi<TName, TState, TNewExtendedProps> => {
			extensions.push(builder);
			const extendedStore = applyExtensions(api as any);
			Object.assign(api, extendedStore);
			return api as unknown as StoreApi<TName, TState, TNewExtendedProps>;
		},
		LocalProvider,
		useLocalStore,
	};
	return api as unknown as StoreApi<TName, TState, {}>;
};

function isObject(value: any): value is Record<string, any> {
	return value instanceof Object && !(value instanceof Array);
}
