/* eslint-disable no-unused-vars */
import { createEffectMethods } from '../create-effects';
import { StoreApi } from '../types';
import { createStore } from './create-zustand-store';

/**
 *  allows for lazy .create() of the store
 *
 * If the store is not created, it will automatically create the store instance
 *
 * However, if you want to define a store without creating it eg only for context, it won't unnecessarily create the store instance
 */
export const createStoreApiProxy = <TStore extends StoreApi<any, any>>(
	storeApi: Partial<TStore>
) => {
	let instance: any;

	const proxy: unknown = new Proxy(instance ?? storeApi, {
		get(target, key, receiver) {
			if (typeof key !== 'string' || key === 'then') {
				return undefined;
			}

			// how this could be made more precise:
			// IF key is one of the store builder methods (eg extend) then pass through
			// ELSE IF key is one of the store methods (eg get) OR key of initial state then create the store instance
			// else return undefined

			// with the current implementation there is some potential for bugs but so far it's working fine so leaving it as is.

			const isActualKeyOfTarget = key in target && !excludedKeys.includes(key);
			if (isActualKeyOfTarget) {
				return Reflect.get(target, key, receiver);
			}

			// automatically create the global store instance
			if (!instance) {
				// @ts-expect-error
				// instance = storeApi.create();
				instance = createStore(storeApi._def);
				Object.assign(instance, storeApi);

				// because it's the global store we want to call the subscribeToEffects method
				// (for the context stores we call them inside useEffect instead)
				const effectMethods = createEffectMethods(instance);

				effectMethods.subscribeToEffects();

				Object.assign(instance, effectMethods);
			}

			return instance[key];
		},
	});

	return instance ?? (proxy as unknown as TStore);
};
const excludedKeys = [
	'constructor',
	'prototype',
	'__proto__',
	'toString',
	'valueOf',
	'toLocaleString',
	'hasOwnProperty',
	'isPrototypeOf',
	'propertyIsEnumerable',
	'length',
	'caller',
	'callee',
	'arguments',
	'name',
	Symbol.toPrimitive,
	Symbol.toStringTag,
	Symbol.iterator,
];
