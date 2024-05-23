import { EffectDefs, EffectMethods } from '../types';

export const createEffectMethods = <TObj extends { _effects: EffectDefs }>(
	obj: TObj
) => {
	const effectDefs = getEffectDefs(obj);
	const unsubMethods: Record<string, () => void> = {};
	const subscribeToEffects = () => {
		Object.entries(effectDefs).forEach(([key, fn]) => {
			// @ts-expect-error
			unsubMethods[key] = fn();
		});
	};

	const unsubscribeFromEffects = () => {
		Object.values(unsubMethods).forEach((fn) => fn());
	};

	const effectMethods: EffectMethods<TObj['_effects']> = {
		_effects: effectDefs,
		unsubscribeFromEffects,
		subscribeToEffects,
	};
	return effectMethods;
};

export const getEffectDefs = (wholeStore: object) => {
	const inner = () => {
		if ('_effects' in wholeStore) {
			return wholeStore._effects;
		}
		if ('effects' in wholeStore) {
			return wholeStore.effects;
		}
		return {};
	};
	return inner() as EffectDefs;
};

// import { EffectBuilder, EffectDefs, EffectMethods, StoreApi } from '../types';
// export const createEffectMethods = <
// 	TStore extends StoreApi<any, any>,
// 	TBuilder extends EffectBuilder<TStore>,
// >(
// 	store: TStore,
// 	builder: TBuilder
// ) => {
// 	const effects = builder(store);
// 	const unsubMethods: Record<string, () => void> = {};

// 	const subscribeToEffects = () => {
// 		Object.entries(effects).forEach(([key, fn]) => {
// 			// @ts-expect-error
// 			unsubMethods[key] = fn();
// 		});
// 	};

// 	const unsubscribeFromEffects = () => {
// 		Object.values(unsubMethods).forEach((fn) => fn());
// 	};

// 	return {
// 		_effects: effects,
// 		unsubscribeFromEffects,
// 		subscribeToEffects,
// 	} satisfies EffectMethods<typeof effects>;
// };
