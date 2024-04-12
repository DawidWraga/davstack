/**
 * CREDIT code adapted from: https://github.com/trpc/trpc/blob/9014326a89cf589c71fa8b96aec6d4d651b5006b/packages/server/src/unstable-core-do-not-import/createProxy.ts#L38
 *
 * and inspired by this great article: https://trpc.io/blog/tinyrpc-client
 */
interface ProxyCallbackOptions {
	target?: unknown;
	path: string[];
	args: unknown[];
}
export type ProxyCallback = (opts: ProxyCallbackOptions) => unknown;

const noop = () => {
	// noop
	// dummy no-op function since we don't have any
	// client-side target we want to remap to
};

function createInnerProxy(
	callback: ProxyCallback,
	path: string[],
	// py passing the innerObj, we allow for the proxy to be used as a normal object
	// this is useful for accessing the target methods of store directly eg store.extend()
	innerObj: any = noop
) {
	const proxy: unknown = new Proxy(innerObj, {
		get(target, key, receiver) {
			if (typeof key !== 'string' || key === 'then') {
				// special case for if the proxy is accidentally treated
				// like a PromiseLike (like in `Promise.resolve(proxy)`)
				return undefined;
			}

			if (key in target && !excludedKeys.includes(key)) {
				return Reflect.get(target, key, receiver);
			}
			// Recursively compose the full path until a function is invoked
			return createInnerProxy(callback, [...path, key]);
		},
		set(target, key, value) {
			if (typeof key === 'string') {
				target[key] = value;
				return true;
			}
			return false;
		},
		apply(target, _thisArg, args) {
			// Call the callback function with the entire path we
			// recursively created and forward the arguments
			const isApply = path[path.length - 1] === 'apply';

			if (isApply) {
				return callback({
					args: args.length >= 2 ? args[1] : [],
					path: path.slice(0, -1),
					target,
				});
			}

			return callback({ path, args, target });
		},
	});

	return proxy;
}

/**
 * Creates a proxy that calls the callback with the path and arguments
 *
 * @internal
 */
export const createRecursiveProxy = (
	callback: ProxyCallback,
	innerObj: any = noop
) => createInnerProxy(callback, [], innerObj);

/**
 * Used in place of `new Proxy` where each handler will map 1 level deep to another value.
 *
 * @internal
 */
export const createFlatProxy = <TFaux>(
	callback: (path: string & keyof TFaux) => any
): TFaux => {
	return new Proxy(noop, {
		get(_obj, name) {
			if (typeof name !== 'string' || name === 'then') {
				// special case for if the proxy is accidentally treated
				// like a PromiseLike (like in `Promise.resolve(proxy)`)
				return undefined;
			}
			return callback(name as any);
		},
	}) as TFaux;
};

// this means that you cannot acess the following properties on the proxy object
// this is to avoid name conflicts with the nested proxy properties
/**
 * We check if key in target to allow for fluent API whene building the store
 * eg store().extend().extend()
 *
 * By checking if the key is in the target, we can allow for the fluent API to work as expected
 *
 * However, this means means that hidden keys such as .length, .name, .toString, etc. could conflict with the stores nested properties eg store({user:{ name: "" }, book: { length: 5 }}) would not work as expected
 *
 * To avoid this, we exclude the following keys from the proxy object
 *
 * However because we check if method !== get/set/assign/onChange/use inside createMethodsProxy, we can still access these properties eg store({books: [1,2,3	]}); store.books.get().length would work as expected
 */
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
