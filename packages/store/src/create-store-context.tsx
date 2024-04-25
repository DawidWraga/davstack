import { State, StoreApi } from './types';

import React from 'react';

type StoreProviderProps<TState, TInput> = {
	initialValue?: Partial<TState> & TInput;
	children: React.ReactNode;
};

export function createStoreContext<
	TState extends State,
	TExtensions extends object,
	TInput extends Record<string, any> = {},
>(store: StoreApi<TState, TExtensions, TInput>) {
	const Context = React.createContext<StoreApi<
		TState,
		TExtensions,
		TInput
	> | null>(null);

	const Provider = (props: StoreProviderProps<TState, TInput>) => {
		const { children, initialValue: localInitialValue } = props;
		const storeInstance = React.useRef<StoreApi<TState, TExtensions, TInput>>(
			store.create(localInitialValue)
		);

		React.useEffect(() => {
			const instance = storeInstance.current;
			if (instance && 'subscribeToEffects' in instance) {
				const fn = instance.subscribeToEffects;
				if (typeof fn === 'function') fn();
			}

			return () => {
				const instance = storeInstance.current;
				if (instance && 'unsubscribeFromEffects' in instance) {
					const fn = instance.unsubscribeFromEffects;
					if (typeof fn === 'function') fn();
				}
			};
		}, []);

		return (
			<Context.Provider value={storeInstance.current as any}>
				{children}
			</Context.Provider>
		);
	};

	const useStore = () => {
		const localStore = React.useContext(Context);

		if (localStore) {
			return localStore;
		}

		throw new Error('useLocalStore must be used within a LocalProvider');
	};

	return {
		Provider,
		useStore,
		Context,
	};
}
