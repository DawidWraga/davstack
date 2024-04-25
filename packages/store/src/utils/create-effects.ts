import { EffectBuilder, StoreApi } from '../types';

export const createEffects = <
	TStore extends StoreApi<any, any, any>,
	TBuilder extends EffectBuilder<TStore>,
>(
	store: TStore,
	builder: TBuilder
) => {
	const effectNameToFn = builder(store);
	const unsubMethods: Record<string, () => void> = {};

	const subscribeToEffects = () => {
		Object.entries(effectNameToFn).forEach(([key, fn]) => {
			// @ts-expect-error
			unsubMethods[key] = fn();
		});
	};

	const unsubscribeFromEffects = () => {
		Object.values(unsubMethods).forEach((fn) => fn());
	};

	const effects = {
		effectNameToFn,
		unsubFromAll: unsubscribeFromEffects,
		subscribeToAll: subscribeToEffects,
	};

	return effects;
};
