/**
 * CREDIT: https://github.com/trpc/trpc/blob/9014326a89cf589c71fa8b96aec6d4d651b5006b/packages/server/src/unstable-core-do-not-import/createProxy.ts#L38
 */
interface ProxyCallbackOptions {
	path: string[];
	args: unknown[];
}
export type ProxyCallback = (opts: ProxyCallbackOptions) => unknown;

const noop = () => {
	// noop
	// dummy no-op function since we don't have any
	// client-side target we want to remap to
};

function createInnerProxy(callback: ProxyCallback, path: string[]) {
	const proxy: unknown = new Proxy(noop, {
		get(_obj, key) {
			if (typeof key !== 'string' || key === 'then') {
				// special case for if the proxy is accidentally treated
				// like a PromiseLike (like in `Promise.resolve(proxy)`)
				return undefined;
			}
			// Recursively compose the full path until a function is invoked
			return createInnerProxy(callback, [...path, key]);
		},
		apply(_1, _2, args) {
			// Call the callback function with the entire path we
			// recursively created and forward the arguments
			const isApply = path[path.length - 1] === 'apply';

			if (isApply) {
				return callback({
					args: args.length >= 2 ? args[1] : [],
					path: path.slice(0, -1),
				});
			}

			return callback({ path, args });
		},
	});

	return proxy;
}

/**
 * Creates a proxy that calls the callback with the path and arguments
 *
 * @internal
 */
export const createRecursiveProxy = (callback: ProxyCallback) =>
	createInnerProxy(callback, []);

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
