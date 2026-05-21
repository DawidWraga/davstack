export * from './action';
export * from './zod-file';
import { serialize } from 'object-to-formdata';

export function objectToFormData<T>(obj: T): T {
	return serialize(obj) as T;
}
