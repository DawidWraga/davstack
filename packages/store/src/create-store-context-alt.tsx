/* eslint-disable no-unused-vars */

import React from 'react';

type AnyFn = (...args: any[]) => any;

export function createContextFromStoreCreator<TStoreCreator extends AnyFn>(
	storeCreator: TStoreCreator
) {
	type StoreCreatorResult = ReturnType<TStoreCreator>;
	type StoreCreatorParams = Parameters<TStoreCreator>[0];

	const Context = React.createContext<StoreCreatorResult | null>(null);

	const Provider = (
		props: StoreCreatorParams & { children: React.ReactNode }
	) => {
		const { children, ...storeCreatorParams } = props;
		const storeInstance = React.useRef<StoreCreatorResult>(
			storeCreator(storeCreatorParams)
		);

		React.useEffect(() => {
			const instance = storeInstance.current;

			const unsubMethods: Record<string, () => void> = {};
			if (instance && 'effects' in instance) {
				const subscribeToEffects = () => {
					Object.entries(instance.effects).forEach(([key, fn]) => {
						// @ts-expect-error
						unsubMethods[key] = fn();
					});
				};
				subscribeToEffects();
			}

			return () => {
				Object.values(unsubMethods).forEach((fn) => fn());
			};
		}, []);

		return (
			<Context.Provider value={storeInstance.current as StoreCreatorResult}>
				{children}
			</Context.Provider>
		);
	};

	const useStore = () => {
		const localStore = React.useContext(Context);

		if (localStore) {
			return localStore;
		}

		throw new Error('useStore must be used within a StoreProvider');
	};

	return {
		Provider,
		useStore,
		Context,
	};
}
