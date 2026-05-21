/**
 * CREDIT FOR TYPES: https://blog.swmansion.com/deep-flatten-typescript-type-c0d123028d82
 */

// Helper type to extract value types from deep flatten paths
type DeepFlattenPaths<T> = T extends object
	? {
			[K in keyof T]: K extends string
				? T[K] extends infer O
					? O extends Record<string, any>
						? `${K}.${DeepFlattenPaths<O> & string}`
						: `${K}`
					: never
				: never;
		}[keyof T]
	: '';

// Helper type to extract value types from deep flatten paths
type DeepFlattenValues<
	T,
	Path extends string,
> = Path extends `${infer Key}.${infer Rest}`
	? Key extends keyof T
		? DeepFlattenValues<T[Key], Rest>
		: never
	: Path extends keyof T
		? T[Path]
		: never;

export type FlattenedObjectWithOverrides<T> = {
	[P in DeepFlattenPaths<T>]: DeepFlattenValues<T, P>;
};

// export type FlattenedObjectWithOverrides<TValue> = CollapseEntries<
// 	CreateObjectEntries<TValue, TValue>
// >;

// type Entry = { key: string; value: unknown };
// type EmptyEntry<TValue> = { key: ''; value: TValue };
// type ExcludedTypes = Date | Set<unknown> | Map<unknown, unknown>;
// type ArrayEncoder = `[${bigint}]`;

// type EscapeArrayKey<TKey extends string> =
// 	TKey extends `${infer TKeyBefore}.${ArrayEncoder}${infer TKeyAfter}`
// 		? EscapeArrayKey<`${TKeyBefore}${ArrayEncoder}${TKeyAfter}`>
// 		: TKey;

// // Transforms entries to one flattened type
// type CollapseEntries<TEntry extends Entry> = {
// 	[E in TEntry as EscapeArrayKey<E['key']>]: E['value'];
// };

// // Transforms array type to object
// type CreateArrayEntry<TValue, TValueInitial> = OmitItself<
// 	TValue extends unknown[] ? { [k: ArrayEncoder]: TValue[number] } : TValue,
// 	TValueInitial
// >;

// // Omit the type that references itself
// type OmitItself<TValue, TValueInitial> = TValue extends TValueInitial
// 	? EmptyEntry<TValue>
// 	: OmitExcludedTypes<TValue, TValueInitial>;

// // Omit the type that is listed in ExcludedTypes union
// type OmitExcludedTypes<TValue, TValueInitial> = TValue extends ExcludedTypes
// 	? EmptyEntry<TValue>
// 	: CreateObjectEntries<TValue, TValueInitial>;

// type CreateObjectEntries<TValue, TValueInitial> = TValue extends object
// 	? {
// 			// Checks that Key is of type string
// 			[TKey in keyof TValue]-?: TKey extends string
// 				? // Nested key can be an object, run recursively to the bottom
// 					CreateArrayEntry<
// 						TValue[TKey],
// 						TValueInitial
// 					> extends infer TNestedValue
// 					? TNestedValue extends Entry
// 						? TNestedValue['key'] extends ''
// 							? {
// 									key: TKey;
// 									value: TNestedValue['value'];
// 								}
// 							:
// 									| {
// 											key: `${TKey}.${TNestedValue['key']}`;
// 											value: TNestedValue['value'];
// 									  }
// 									| {
// 											key: TKey;
// 											value: TValue[TKey];
// 									  }
// 						: never
// 					: never
// 				: never;
// 		}[keyof TValue] // Builds entry for each key
// 	: EmptyEntry<TValue>;
