// src/utils/flattenObject.ts
import { FlattenedObjectWithoutOverrides } from './flatten-object.types';
import { FlattenedObjectWithOverrides } from './flatten-object-override.types';

function isObject(value: any): value is Record<string, any> {
	return value instanceof Object && !(value instanceof Array);
}

type FlattenObjectOptions<
	T extends Record<string, any>,
	TOverride extends boolean = false,
> = {
	/**
	 * The prefix to use when flattening the object
	 *
	 */
	prefix?: string;

	/**
	 * When enabled, existing keys in the unflattened object may be overwritten if they cannot hold a newly encountered nested value
	 * @example
	 * ```ts
	 
	  const flat = flattenObject({
	   a: {
	    b: {
	     c: 'value1'
	   }
	  }, { overwrite: true })

    // if overwrite is true
	  // flat.a.b.c = 'value1'

    // if overwrite is false
    // flat.a = { b: { c: 'value1' } }
    // flat.a.b = { c: 'value1' }
    // flat.a.b.c = 'value1'
	 
	 * ```
	 */
	overwrite?: TOverride;
};

export function flattenObject<
	T extends Record<string, any>,
	TOverride extends boolean = false,
>(obj: T, options: FlattenObjectOptions<T, TOverride> = {}) {
	const { prefix = '', overwrite = false } = options;
	const flatObject: any = {};
	for (const [key, value] of Object.entries(obj)) {
		const newKey = prefix ? `${prefix}.${key}` : key;

		if (!isObject(value)) {
			flatObject[newKey] = value;
			continue;
		}

		// recursively flatten the object
		const nestedFlattenedObject = flattenObject(value, {
			prefix: newKey,
			overwrite,
		});

		// if overwrite then set the nested object to the flat object
		if (!overwrite) {
			flatObject[newKey] = nestedFlattenedObject;
		}

		// if not overwrite then assign the nested object to the flat object
		if (overwrite) {
			Object.assign(flatObject, nestedFlattenedObject);
			continue;
		}
	}
	return flatObject as FlattenedObject<T, TOverride>;
}

export type FlattenedObject<
	TValue,
	TOverwrite extends boolean = false,
> = TOverwrite extends true
	? FlattenedObjectWithOverrides<TValue>
	: FlattenedObjectWithoutOverrides<TValue>;
