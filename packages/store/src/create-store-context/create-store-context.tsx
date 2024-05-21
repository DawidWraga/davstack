import React, { forwardRef } from 'react';
import { StateValue, StoreApi } from '../types';

type StoreProviderProps<TState, TInput> = {
	initialValue?: Partial<TState> & TInput;
	children: React.ReactNode;
};

export function createStoreContext<
	TStateValue extends StateValue,
	TExtensions extends object,
	TInput extends Record<string, any> = {},
>(store: StoreApi<TStateValue, TExtensions, TInput>) {
	const Context = React.createContext<StoreApi<
		TStateValue,
		TExtensions,
		TInput
	> | null>(null);

	const Provider = (props: StoreProviderProps<TStateValue, TInput>) => {
		const { children, initialValue: localInitialValue } = props;
		const storeInstance = React.useRef<
			StoreApi<TStateValue, TExtensions, TInput>
		>(store.create(localInitialValue));

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

	const withProvider = <TProps extends object>(Component: React.FC<TProps>) => {
		const WrappedComponent = forwardRef(
			(props: TProps & { initialValue: Partial<TStateValue> }, ref) => {
				return (
					<Provider initialValue={props.initialValue as any}>
						<Component {...props} ref={ref} />
					</Provider>
				);
			}
		);

		WrappedComponent.displayName = `withProvider(${
			Component.displayName || Component.name || 'Component'
		})`;

		return WrappedComponent;
	};

	return {
		Provider,
		useStore,
		withProvider,
		Context,
	};
}
