export function isFunction<T extends Function = Function>(
	value: any
): value is T {
	return typeof value === 'function';
}

export function isObject(value: any): value is Record<string, any> {
	return value instanceof Object && !(value instanceof Array);
}
