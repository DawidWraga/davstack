/**
 
 * @link https://github.com/ianstormtaylor/superstruct/blob/7973400cd04d8ad92bbdc2b6f35acbfb3c934079/src/utils.ts#L323-L325
 */
export type Simplify<T> = T extends any[] | Date
	? T
	: { [K in keyof T]: T[K] } & {};

import { ZodType } from 'zod';

/**
 * zInfer is identical to using import { infer as zInfer } from 'zod';
 * Except tsup kept not renaming the import, causing a conflict with the infer keyword.
 * This is a workaround to avoid renaming the import, which would break the build.
 */
export type zInfer<T extends ZodType<any, any, any>> = T['_output'];
