/* eslint-disable no-unused-vars */
import { enableMapSet, setAutoFreeze } from 'immer';

import {
	devtools as devtoolsMiddleware,
	persist as persistMiddleware,
} from 'zustand/middleware';
import { createStore as createVanillaStore } from 'zustand/vanilla';

import {
	ImmerStoreApi,
	SetImmerState,
	StateValue,
	StoreApi,
	StoreDef,
} from '../types';
import { pipe } from '../utils/pipe';
import { immerMiddleware } from './immer.middleware';

import type { StateCreator } from 'zustand';

import { subscribeWithSelector } from 'zustand/middleware';
import { createMethodsProxy } from '../create-state-methods/create-methods-proxy';
import { State } from '../create-state-methods/state.types';
import { getDefaultStoreDef } from '../store-builder/store';
import { isObject } from '../utils/assertions';
/** creates the internal store with middlwares */
export const createInnerStore = <TState extends StateValue>(
	storeDef: StoreDef<TState>
) => {
	const { options, initialState, name } = storeDef;

	const {
		middlewares: _middlewares = [],
		devtools,
		persist,
		immer,
	} = options ?? {};

	const pipeMiddlewares = (
		// @ts-expect-error
		createState: StateCreator<TState, SetImmerState<TState>>
	) => pipe(createState as any, ...middlewares) as ImmerStoreApi<TState>;

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

	middlewares.push(subscribeWithSelector);
	middlewares.push(createVanillaStore);

	// // cannot use nullish here as it breaks when initial value is eg 0
	// if (initialState === undefined) {
	// 	// consider making this throw? most a bug if there is a store without a state
	// 	// throw new Error('Store must have an initial state');
	// 	console.warn(
	// 		'store initialized without an initial state. This could indicate a bug.'
	// 	);
	// }

	const immerStoreApi = pipeMiddlewares(() => initialState as TState);

	return immerStoreApi;
};

export function createStore<
	TState extends StateValue,
	TExtendedProps extends Record<string, any> = {},
	TInput extends Record<string, any> = {},
>(
	storeDef: StoreDef<TState>,
	instanceInitialValue?: Partial<TState>,
	instanceInput: Partial<TInput> = {}
) {
	const { initialState, extensions, name } = storeDef;

	if (instanceInput) {
		storeDef.extensions.push((store) => instanceInput);
	}

	// if is object then merge, otherwise use the localInitialValue and fallback to initialState
	const mergedInitialState = isObject(initialState)
		? {
				...initialState,
				...(instanceInitialValue as object),
			}
		: ((instanceInitialValue ?? initialState) as TState);

	const innerStore = createInnerStore({
		...storeDef,
		initialState: mergedInitialState,
	});

	const methods = createMethodsProxy({
		immerStore: innerStore,
		storeName: name,
	});

	const applyExtensions = (store: StoreApi<TState, {}>) => {
		if (!storeDef.extensions.length) return store;
		return storeDef.extensions.reduce((acc, ext) => {
			// should avoid using spread operator here as it reduce + spread harms performance
			return Object.assign(acc, ext(acc));
		}, store);
	};

	applyExtensions(methods as any);

	Object.assign(methods, { _def: storeDef });

	return methods as unknown as StoreApi<TState>;
}

export function state<TState extends StateValue>(
	initialState?: TState,
	storeDef?: Partial<StoreDef<TState>>
): State<TState> {
	const defaultDef = getDefaultStoreDef(initialState) as StoreDef<TState>;
	const defWithDefaults = { ...defaultDef, ...storeDef };

	const innerStore = createInnerStore({
		...defWithDefaults,
		initialState: initialState,
	});

	return createMethodsProxy({
		immerStore: innerStore,
		storeName: defWithDefaults.name,
	}) as unknown as State<TState>;
}
