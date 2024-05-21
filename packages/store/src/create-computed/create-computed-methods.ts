/* eslint-disable no-unused-vars */

import { Simplify, StoreApi } from '../types';

type ComputedDef<TReadValue, TWriteInput = TReadValue, TReadInput = void> =
	| {
			read: (input: TReadInput) => TReadValue;
			write?: (value: TWriteInput) => void;
	  }
	| ((input: TReadInput) => TReadValue);

export type ComputedProps = Record<string, ComputedDef<any, any, any>>;

type VoidIfUnknown<T> = unknown extends T ? void : T;

type ComputedDefToMethods<TComputedDef> = TComputedDef extends (
	input: infer TReadInput
) => infer TReadValue
	? {
			use: (input: VoidIfUnknown<TReadInput>) => TReadValue;
			get: (input: VoidIfUnknown<TReadInput>) => TReadValue;
		}
	: TComputedDef extends {
				read: (input: infer TReadInput) => infer TReadValue;
				write?: (value: infer TWriteInput) => void;
		  }
		? {
				use: (input: VoidIfUnknown<TReadInput>) => TReadValue;
				get: (input: VoidIfUnknown<TReadInput>) => TReadValue;
				set: TComputedDef['write'] extends undefined
					? never
					: (value: TWriteInput) => void;
			}
		: never;

export type ComputedMethods<TComputedProps extends ComputedProps> = {
	[K in keyof TComputedProps]: ComputedDefToMethods<TComputedProps[K]>;
};

export type ComputedBuilder<TStore, TComputedProps extends ComputedProps> = (
	store: TStore
) => TComputedProps;

function hasWrite<TReadValue, TWriteInput, TReadInput>(
	def: ComputedDef<TReadValue, TWriteInput, TReadInput>
): def is {
	read: (input: TReadInput) => TReadValue;
	write: (value: TWriteInput) => void;
} {
	return typeof (def as any).write === 'function';
}

export function createComputedMethods<
	TStore,
	TComputedProps extends ComputedProps,
>(
	store: TStore,
	computedCallback: ComputedBuilder<TStore, TComputedProps>
): ComputedMethods<TComputedProps> {
	const computedKeys = Object.keys(
		computedCallback(
			new Proxy(store as any, {
				get: (target, prop) => {
					if (prop === 'get' || prop === 'use' || prop === 'set') {
						return () => {}; // Dummy function
					}
					return Reflect.get(target, prop);
				},
			})
		)
	) as (keyof TComputedProps)[];

	const computedProperties = computedCallback(store);
	const computedMethods = Object.fromEntries(
		computedKeys.map((key) => {
			const computedProperty = computedProperties[key];
			const isFunction = typeof computedProperty === 'function';

			// use: () => computedProperties[key](),
			// get: () => {
			// 	// @ts-expect-error
			// 	store._replaceUseWithGet = true;

			// 	const result = computedCallback(store)[key]();
			// 	// @ts-expect-error
			// 	store._replaceUseWithGet = false;

			// 	return result;
			// },

			if (isFunction) {
				return [
					key,
					{
						// @ts-expect-error
						use: (...args: any[]) => computedProperty(...args),
						get: (...args: any[]) => {
							// @ts-expect-error
							store._replaceUseWithGet = true;

							// @ts-expect-error
							const result = computedCallback(store)[key](...args);
							// @ts-expect-error
							store._replaceUseWithGet = false;

							return result;
						},
					},
				];
			}

			return [
				key,
				{
					use: (input: any) => computedProperty.read(input),
					get: (input: any) => computedProperty.read(input),
					...(hasWrite(computedProperty)
						? {
								set: (value: any) => computedProperty.write!(value),
							}
						: {}),
				},
			];
		})
	);

	return computedMethods as ComputedMethods<TComputedProps>;
}
type GetOrUse = 'get' | 'use';
type ComputedStandalone<TReturnType> = TReturnType extends (
	getOrUse: GetOrUse
) => infer TResult
	? { get: () => TResult; use: () => TResult }
	: TReturnType extends {
				get: (input: infer TInputType) => infer TResultType;
				set: (value: infer TValueType) => void;
		  }
		? {
				get: (input: VoidIfUnknown<TInputType>) => TResultType;
				use: (input: VoidIfUnknown<TInputType>) => TResultType;
				set: (value: TValueType) => void;
			}
		: TReturnType extends {
					get: (input: infer TInputType) => infer TResultType;
			  }
			? {
					get: (input: VoidIfUnknown<TInputType>) => TResultType;
					use: (input: VoidIfUnknown<TInputType>) => TResultType;
				}
			: { get: () => TReturnType; use: () => TReturnType };

export function computed<TReturnType>(
	fn: (getOrUse: GetOrUse) => TReturnType
): ComputedStandalone<TReturnType> {
	const result: any = {
		get: (...args: any[]) => {
			const proxyResult = fn('get');
			if (typeof proxyResult === 'function') {
				return proxyResult(...args);
			}
			return proxyResult;
		},
		use: (...args: any[]) => {
			const proxyResult = fn('use');
			if (typeof proxyResult === 'function') {
				return proxyResult(...args);
			}
			return proxyResult;
		},
	};

	const proxyResult = fn('get');
	if (typeof proxyResult === 'object' && 'set' in (proxyResult as any)) {
		result.set = (value: any) => (proxyResult as any).set(value);
	}

	return result as ComputedStandalone<TReturnType>;
}
