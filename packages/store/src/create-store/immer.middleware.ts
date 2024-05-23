import { produce, isDraftable } from 'immer';
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
		const setState: SetImmerState<T> = (callback, actionName) => {
			return set(
				(state) => {
					// console.log('SETTING STATE', { state, callback, actionName });
					// if (Array.isArray(state)) {
					// 	// If the state is an array, create a new array and assign its elements
					// 	const newState = [...state];
					// 	// @ts-expect-error
					// 	callback(newState);
					// 	return newState;
					// } else

					if (isDraftable(state)) {
						// If the state is draftable, use Immer's produce function
						// @ts-expect-error
						return produce(state, callback);
					} else {
						// If the state is not draftable, directly call the callback without using Immer
						// @ts-expect-error
						return callback(state);
						// return produce(state, callback);
					}
				},
				true,
				actionName
			);
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
