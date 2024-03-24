/**
 
 * @link https://github.com/ianstormtaylor/superstruct/blob/7973400cd04d8ad92bbdc2b6f35acbfb3c934079/src/utils.ts#L323-L325
 */
export type Simplify<T> = T extends any[] | Date
	? T
	: { [K in keyof T]: T[K] } & {};
