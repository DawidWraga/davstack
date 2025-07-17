/**
 * Utility functions for managing sensitive data in logging
 */

import { ZodSchema, ZodType, ZodObject, ZodArray } from 'zod';

/**
 * Mark a field as sensitive in a Zod schema
 * @param schema The Zod schema to mark as sensitive
 * @returns The same schema with privacy metadata
 */
export function sensitive<T extends ZodType>(schema: T): T {
	return schema.describe('sensitive') as T;
}

/**
 * Checks if a schema or schema property is marked as sensitive
 */
export function isSensitive(schema?: ZodSchema<any> | null): boolean {
	if (!schema) return false;
	return schema.description === 'sensitive';
}

/**
 * Redact sensitive values in an object based on the schema
 * @param data The data to redact
 * @param schema The schema describing sensitive fields
 * @returns A new object with sensitive data redacted
 */
export function redactSensitive<T>(data: T, schema?: ZodSchema<any> | null): T {
	if (!schema || data === undefined || data === null) return data;

	// If the entire schema is marked sensitive, redact the whole value
	if (isSensitive(schema)) return '[REDACTED]' as any;

	// Handle functions - don't try to traverse them
	if (typeof data === 'function') {
		return '[Function]' as any;
	}

	// Handle primitive values
	if (typeof data !== 'object' || data === null) {
		return data;
	}

	// Handle arrays
	if (Array.isArray(data)) {
		try {
			// Try to get element schema if it's an array schema
			const elementSchema = schema instanceof ZodArray ? schema.element : null;
			if (!elementSchema) return data;
			return data.map((item) => redactSensitive(item, elementSchema)) as any;
		} catch (e) {
			return data;
		}
	}

	try {
		// Get schema shape for objects
		let shape: Record<string, ZodSchema<any>> | null = null;

		if (schema instanceof ZodObject) {
			// For ZodObject we can get the shape
			shape = schema.shape as Record<string, ZodSchema<any>>;
		}

		if (!shape) return data;

		const result = { ...data } as Record<string, any>;

		// Process each field in the schema shape
		for (const key in shape) {
			if (Object.prototype.hasOwnProperty.call(result, key)) {
				const fieldSchema = shape[key];

				// Check if this field is marked as sensitive
				if (isSensitive(fieldSchema)) {
					result[key] = '[REDACTED]';
				}
				// Handle functions - display as [Function] in logs
				else if (typeof result[key] === 'function') {
					result[key] = '[Function]';
				}
				// If it's an object or array, recursively process it
				else if (result[key] !== null && typeof result[key] === 'object') {
					result[key] = redactSensitive(result[key], fieldSchema);
				}
			}
		}

		return result as T;
	} catch (e) {
		// If any errors in processing, return as is
		return data;
	}
}
