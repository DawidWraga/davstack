import { ImmerStoreApi, SetRecord, State } from '../types';

export const generateStateActions = <T extends State>(
	store: ImmerStoreApi<T>,
	storeName: string
) => {
	const actions: SetRecord<T> = {} as any;
	Object.keys((store as any).getState()).forEach((key) => {
		actions[key as keyof T] = (value) => {
			const isCallback = isFunction(value);
			const isValue = !isCallback;

			// if is value and the value is the same as the current value, return early
			if (isValue) {
				const prevValue = store.getState()[key as keyof T];
				const noChange = prevValue === value;
				if (noChange) return;
			}

			const actionKey = key.replace(/^\S/, (s) => s.toUpperCase());
			store.setState((draft) => {
				if (isValue) {
					// @ts-expect-error
					draft[key] = value;
				}

				// if is callback, pass the current state value to it
				if (isCallback) {
					// @ts-expect-error
					draft[key] = value(draft[key]);
				}
			}, `@@${storeName}/set${actionKey}`);
		};
	});
	return actions;
};

export function isFunction<T extends Function = Function>(
	value: any
): value is T {
	return typeof value === 'function';
}
