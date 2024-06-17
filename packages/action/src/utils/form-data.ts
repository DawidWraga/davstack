/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 *  CREDIT: https://github.com/trpc/trpc/blob/72c684683626b54907cccf8a12f3a3d726471652/packages/next/src/app-dir/formDataToObject.ts
 */

export function isFormData(value: unknown): value is FormData {
	if (typeof FormData === 'undefined') {
		// FormData is not supported
		return false;
	}
	return value instanceof FormData;
}

function set(
	obj: Record<string, any>,
	path: string[] | string,
	value: unknown
): void {
	if (typeof path === 'string') {
		path = path.split(/[\.\[\]]/).filter(Boolean);
	}

	if (path.length > 1) {
		const p = path.shift()!;
		const isArrayIndex = /^\d+$/.test(path[0]!);
		obj[p] = obj[p] || (isArrayIndex ? [] : {});
		set(obj[p], path, value);
		return;
	}
	const p = path[0]!;
	if (obj[p] === undefined) {
		obj[p] = value;
	} else if (Array.isArray(obj[p])) {
		obj[p].push(value);
	} else {
		obj[p] = [obj[p], value];
	}
}

export function formDataToObject(formData: FormData) {
	const obj: Record<string, unknown> = {};

	for (const [key, value] of formData.entries()) {
		set(obj, key, value);
	}

	return obj;
}

export function getMaybeFormDataValue<T>(value: T | FormData): T {
	if (isFormData(value)) {
		return formDataToObject(value) as any;
	}

	return value;
}

