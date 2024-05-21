import { produce } from 'immer';
import { StoreApi as RawStoreApi, StoreApi as ZustandStoreApi } from 'zustand';
import { NamedSet } from 'zustand/middleware';
import { SetImmerState, StateValue } from '../types';

export const immerMiddleware =
	<T extends StateValue>(
		config: StateCreatorWithDevtools<
			T,
			SetImmerState<T>,
			ZustandStoreApi<T>['getState']
		>
	): StateCreatorWithDevtools<T> =>
	(set, get, api) => {
		const setState: SetImmerState<T> = (fnOrValue, actionName) => {
			// @ts-expect-error
			return set(produce<T>(fnOrValue, true, actionName));
			// if (isFunction(fnOrValue)) {
			// 	// @ts-expect-error
			// 	set(produce<T>(fnOrValue, true, actionName));
			// } else {
			// 	// @ts-expect-error
			// 	set(() => fnOrValue, actionName);
			// }
		};
		api.setState = setState as any;
		return config(setState, get, api);
	};

export type StateCreatorWithDevtools<
	T extends StateValue,
	CustomSetState = NamedSet<T>,
	CustomGetState = ZustandStoreApi<T>['getState'],
	CustomStoreApi extends RawStoreApi<T> = RawStoreApi<T>,
> = (set: CustomSetState, get: CustomGetState, api: CustomStoreApi) => T;
