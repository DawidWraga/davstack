import React, { forwardRef } from 'react';
import { createEffectMethods } from '../create-effects';
import { StoreApi } from '../types';

type AnyFn = (...args: any[]) => any;

export function createStoreContext<TCreator extends StoreApi<any, any> | AnyFn>(
	creator: TCreator
) {
	type StoreInstance = TCreator extends AnyFn
		? ReturnType<TCreator>
		: TCreator extends StoreApi<infer TState, infer TExtensions>
			? StoreApi<TState, TExtensions>
			: never;

	type StoreParams = TCreator extends AnyFn
		? Parameters<TCreator>[0]
		: // we must infer the TState AND TExtensions here for the ts complier to work correctly at build time
			TCreator extends StoreApi<infer TState, infer TExtensions>
			? { initialState?: Partial<TState> }
			: never;

	const createInstance = (props: StoreParams): StoreInstance => {
		if (typeof creator === 'function') {
			return creator(props as StoreParams);
		}

		return (creator as StoreInstance).create(
			(props as StoreParams).initialState
		);
	};

	const Context = React.createContext<StoreInstance | null>(null);

	const Provider = (
		props: {
			children: React.ReactNode;
		} & StoreParams
	) => {
		const { children, ...restProps } = props;
		const storeInstance = React.useRef<StoreInstance>(
			createInstance(restProps as StoreParams)
		);

		React.useEffect(() => {
			const instance = storeInstance.current;
			if (!instance) return;

			const effectMethods = createEffectMethods(instance as any);

			effectMethods.subscribeToEffects();

			return () => {
				effectMethods.unsubscribeFromEffects();
			};
		}, []);

		return (
			<Context.Provider value={storeInstance.current as StoreInstance}>
				{children}
			</Context.Provider>
		);
	};

	const useStore = () => {
		const localStore = React.useContext(Context);

		if (localStore) return localStore as StoreInstance;

		throw new Error('useLocalStore must be used within a LocalProvider');
	};

	const withProvider = <TProps extends unknown>(Component: React.FC<TProps>) => {
		const WrappedComponent = forwardRef((props: TProps & StoreParams, ref) => {
			return (
				<Provider {...props}>
					<Component {...props} ref={ref} />
				</Provider>
			);
		});

		WrappedComponent.displayName = `withProvider(${
			Component.displayName || Component.name || 'Component'
		})`;

		// casting this type here makes it simpler in the IDE but not sure if it has any unintended side effects
		return WrappedComponent as React.FC<TProps & StoreParams>;
	};

	return {
		Provider,
		useStore,
		withProvider,
		Context,
	};
}
