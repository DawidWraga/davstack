/* eslint-disable prettier/prettier */
import React from 'react';

import { State, StoreApi } from '../types';
import { createStore } from '../createStore';

export const storeFactory = <
	TName extends string,
	T extends State,
	TExtendedProps extends Record<string, any>,
>(
	api: StoreApi<TName, T, TExtendedProps>
) => {
	return {
		...api,
		extend: <TNewExtendedProps extends Record<string, any>>(
			builder: (store: StoreApi<TName, T, TExtendedProps>) => TNewExtendedProps
		): StoreApi<TName, T, TExtendedProps & TNewExtendedProps> =>
			// @ts-expect-error
			storeFactory({
				...api,
				...builder(api),
			}),
		withLocal: () => {
			const LocalContext =
				React.createContext<StoreApi<TName, T, TExtendedProps>>(api);

			const LocalProvider = ({
				children,
				initialValue: localInitialValue = {},
			}: {
				initialValue?: Partial<T>;
				children: React.ReactNode;
			}) => {
				const localStore = createStore(
					{
						...api.immerStoreApi.getState(),
						...localInitialValue,
					},
					{
						name: `${api.storeName}-local`,
					}
				);

				// const { withLocal, ...newApi } = storeFactory({
				// 	...api,
				// });
				// newApi.assign(localInitialValue);

				return (
					// @ts-expect-error
					<LocalContext.Provider value={newApi}>
						{children}
					</LocalContext.Provider>
				);
			};

			return {
				...api,
				LocalProvider,
				useLocalStore: () => {
					const localStore = React.useContext(LocalContext);
					console.log('localStore valuse:', localStore.get());

					if (localStore) {
						return localStore;
					}

					throw new Error('useLocal must be used within a LocalProvider');
				},
			};
		},
	};
};
