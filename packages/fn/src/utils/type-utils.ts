// CHANGED: Import from the stable v3 and v4 core subpaths
import * as z3 from 'zod/v3';
// import * as z4 from 'zod/v4/core';

/**
 * @link https://github.com/ianstormtaylor/superstruct/blob/7973400cd04d8ad92bbdc2b6f35acbfb3c934079/src/utils.ts#L323-L325
 */
export type Simplify<T> = T extends any[] | Date
	? T
	: { [K in keyof T]: T[K] } & {};

//* MARK: OLD ------------
// export type zInfer<T extends ZodTypeAny> = T['_output'];
// export type zInferInput<T extends ZodTypeAny> = T['_input'];

// export type ZodTypeAny = z3.ZodTypeAny;

//* MARK: NEW ------------

// NEW: Version-agnostic type inference for the schema's output type.
// It uses conditional types to check if the provided schema is a v3 or v4 type.

import * as z4 from 'zod/v4/core';
export type zInfer<T> = T extends z3.ZodTypeAny
	? z3.infer<T>
	: T extends z4.$ZodType
		? z4.output<T>
		: never;

// NEW: Version-agnostic type inference for the schema's input type.
export type zInferInput<T> = T extends z3.ZodTypeAny
	? z3.input<T>
	: T extends z4.$ZodType
		? z4.input<T>
		: never;

export type ZodTypeAny = z3.ZodTypeAny | z4.$ZodType;

export function isZod4(schema: ZodTypeAny): schema is z4.$ZodType {
	return '_zod' in schema;
}
