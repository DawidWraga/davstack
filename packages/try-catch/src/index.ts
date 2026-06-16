/**
 * The result of a `tryCatch` call: exactly one of `data` or `error` is non-null.
 *
 * Discriminate on `error`:
 *
 * ```ts
 * const { data, error } = await tryCatch(fetchUser());
 * if (error) return handle(error);
 * use(data); // narrowed to non-null
 * ```
 */
export type Result<T, E = Error> =
	| { data: T; error: null }
	| { data: null; error: E };

export type Awaitable<T> = T | Promise<T>;

/**
 * Wraps a promise (or a thunk returning a value/promise) and resolves to a
 * `{ data, error }` result instead of throwing.
 *
 * Prefer the thunk form when the work might throw *synchronously* (before a
 * promise is created) — passing `tryCatch(doThing())` evaluates `doThing()`
 * outside the try/catch, so a synchronous throw would escape. `tryCatch(() =>
 * doThing())` catches both sync and async failures.
 *
 * @example
 * const { data, error } = await tryCatch(() => createUser({ input }));
 * if (error) { ... }
 */
export async function tryCatch<T, E = Error>(
	input: Promise<T> | (() => Awaitable<T>)
): Promise<Result<T, E>> {
	try {
		const data = await (typeof input === "function"
			? (input as () => Awaitable<T>)()
			: input);
		return { data, error: null };
	} catch (error) {
		return { data: null, error: error as E };
	}
}
