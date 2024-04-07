import { produce } from 'immer';
import { StoreApi } from 'zustand';

import { SetImmerState, State, StateCreatorWithDevtools } from '../types';
import { isFunction } from '../utils';

export const immerMiddleware =
	<T extends State>(
		config: StateCreatorWithDevtools<
			T,
			SetImmerState<T>,
			StoreApi<T>['getState']
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
