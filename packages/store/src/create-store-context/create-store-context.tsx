import React, { forwardRef } from 'react';
import { createEffectMethods } from '../create-effects';
import { StoreApi } from '../types';

// type StoreProviderProps<TState> = {
// 	initialState?: Partial<TState>;
// 	children: React.ReactNode;
// };

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
		: Partial<
				StoreInstance extends StoreApi<infer TState, any> ? TState : never
			>;

	type ProviderProps = TCreator extends AnyFn
		? StoreParams
		: TCreator extends StoreApi<infer TState, any>
			? {
					initialState?: Partial<TState>;
				}
			: never;

	const createInstance = (props: StoreParams): StoreInstance => {
		if (typeof creator === 'function') {
			return creator(props as any);
		}

		return (creator as StoreInstance).create(props.initialState as any);
	};

	const Context = React.createContext<StoreInstance | null>(null);

	const Provider = (
		props: {
			children: React.ReactNode;
		} & ProviderProps
	) => {
		const { children, ...restProps } = props;
		const storeInstance = React.useRef<StoreInstance>(
			createInstance(restProps as any)
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
			<Context.Provider value={storeInstance.current as any}>
				{children}
			</Context.Provider>
		);
	};

	const useStore = () => {
		const localStore = React.useContext(Context);

		if (localStore) return localStore;

		throw new Error('useLocalStore must be used within a LocalProvider');
	};

	const withProvider = <TProps extends object>(Component: React.FC<TProps>) => {
		const WrappedComponent = forwardRef(
			(props: TProps & ProviderProps, ref) => {
				return (
					<Provider {...props}>
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
