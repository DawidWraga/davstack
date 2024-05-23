/* eslint-disable no-unused-vars */

import React, { forwardRef } from 'react';
import { createEffectMethods, getEffectDefs } from '../create-effects';

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
		const storeInstance = React.useRef<StoreCreatorResult | null>(
			storeCreator(storeCreatorParams)
		);

		React.useEffect(() => {
			const instance = storeInstance.current;
			if (!instance) return;

			const effectMethods = createEffectMethods(instance);

			effectMethods.subscribeToEffects();

			return () => {
				effectMethods.unsubscribeFromEffects();
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

	const withProvider = <TProps extends object>(Component: React.FC<TProps>) => {
		const WrappedComponent = forwardRef(
			(props: TProps & StoreCreatorParams, ref) => {
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
		withProvider,
		useStore,
		Context,
	};
}
