import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { baseFn } from '../src';
import { FnError } from '../src/errors';
import { redactSensitive, sensitive } from '../src/utils/zod-sensitive';
import { createMockLogger, testData } from './test-utils';

describe('Fn Logging and Errors', () => {
	// Create spies for the logger functions
	const logger = createMockLogger();

	const customFn = baseFn().options({
		onError(opts: { error: Error; ctx: any; meta: any; input: any }) {
			// Early return if already reported
			if ((opts.error as any)._reported) return;

			// Log error with context
			logger.error(opts.error, {
				input: opts.input,
				meta: opts.meta,
			});
		},

		wrapper: (innerFn) => async (opts) => {
			// Skip logging if preventLogging is set
			if (opts.preventLogging) return await innerFn(opts);

			logger.debug('calling fn', {
				...opts.meta,
				input: redactSensitive(opts.input, opts.inputSchema),
			});

			const result = await innerFn(opts);

			// Redact the result if the output schema is marked as sensitive
			const redactedResult = redactSensitive(result, opts.outputSchema);
			logger.debug('fn result', redactedResult);

			return result;
		},
	});

	const createUser = customFn
		.meta({ key: 'createUser' })
		.input(testData.input)
		.output(testData.output)
		.mutation(async ({ input }) => {
			return testData.defaultOutput;
		});

	// Reset mocks before each test
	beforeEach(() => {
		logger.cleanup();
	});

	describe('Direct call', () => {
		test('Should return direct values on success', async () => {
			const user = await createUser({ input: { name: 'test' } });
			expect(user).toStrictEqual(testData.defaultOutput);

			// Verify logging
			expect(logger.debug).toHaveBeenCalledWith('calling fn', {
				key: 'createUser',
				input: { name: 'test' },
			});
			expect(logger.debug).toHaveBeenCalledWith(
				'fn result',
				testData.defaultOutput
			);
		});

		test('Should NOT throw validation errors', async () => {
			const result = await createUser({ input: { name: 123 as any } });
			expect(result).toMatchObject(testData.defaultOutput);
		});

		test('Should throw execution errors', async () => {
			const errorFn = customFn
				.meta({ key: 'errorFn' })
				.input({ trigger: z.boolean() })
				.mutation(async ({ input }) => {
					if (input.trigger) {
						throw new Error('Triggered error');
					}
					return { success: true };
				});

			await expect(async () => {
				const result = await errorFn({ input: { trigger: true } });
				console.log('result', result);
			}).rejects.toThrow('Triggered error');

			// Verify error was logged
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'Triggered error' }),
				expect.any(Object)
			);
		});
	});

	describe('safeCall', () => {
		test('Should return data on success', async () => {
			const { data: user, error } = await createUser.safeCall({
				input: { name: 'test' },
			});
			expect(user).toStrictEqual(testData.defaultOutput);
			expect(error).toBeNull();
		});

		test('Should return error on input validation errors', async () => {
			const { data, error } = await createUser.safeCall({
				input: { name: 123 as any },
			});
			expect(data).toBeNull();
			expect(error).toBeInstanceOf(FnError);
			expect((error as FnError).code).toBe('INVALID_INPUT');

			// Verify error was logged
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					code: 'INVALID_INPUT',
					message: expect.stringContaining('Expected string'),
				}),
				expect.any(Object)
			);
		});

		test('Should return error on output validation errors', async () => {
			const differentCreateUser = customFn
				.meta({ key: 'differentCreateUser' })
				.input(z.any())
				.output(z.string())
				.mutation(async ({ input }) => {
					return input.name;
				});

			const { data, error } = await differentCreateUser.safeCall({
				input: { name: 555 },
			});
			expect(data).toBeNull();
			expect(error).toBeInstanceOf(FnError);
			expect((error as FnError).code).toBe('INVALID_OUTPUT');

			// Verify error was logged with correct code and informative message
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					code: 'INVALID_OUTPUT',
					message: expect.stringContaining('Expected string'),
				}),

				expect.any(Object)
			);
		});

		// Add test for throwing explicit FnErrors
		test('Should handle custom FnErrors correctly', async () => {
			const notFoundFn = customFn
				.meta({ key: 'notFoundFn' })
				.input({ id: z.string() })
				.mutation(async ({ input }) => {
					throw new FnError({
						code: 'NOT_FOUND',
						message: `User with id ${input.id} not found`,
						meta: { userId: input.id },
					});
				});

			const { data, error } = await notFoundFn.safeCall({
				input: { id: 'test123' },
			});
			expect(data).toBeNull();
			expect(error).toBeInstanceOf(FnError);
			expect((error as FnError).code).toBe('NOT_FOUND');
			expect((error as FnError).message).toBe('User with id test123 not found');
			expect((error as FnError).meta).toHaveProperty('userId', 'test123');
		});

		// Add test for direct error code usage
		test('Should allow direct error code usage', async () => {
			const directErrorFn = customFn
				.meta({ key: 'directErrorFn' })
				.mutation(async () => {
					throw new FnError({
						code: 'FORBIDDEN',
						message: 'You do not have permission to perform this action',
					});
				});

			await expect(async () => {
				await directErrorFn({});
			}).rejects.toThrow('You do not have permission to perform this action');

			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					code: 'FORBIDDEN',
					message: 'You do not have permission to perform this action',
				}),
				expect.any(Object)
			);
		});
	});

	describe('Nested calls', () => {
		// Test: Error from nested function is reported only once
		test('should report nested errors only once', async () => {
			// Setup nested functions
			const innerFn = customFn
				.meta({ key: 'innerFn' })
				.input({ value: z.number() })
				.mutation(async ({ input }) => {
					throw new Error('Inner error');
				});

			const outerFn = customFn
				.meta({ key: 'outerFn' })
				.input({ id: z.string() })
				.mutation(async ({ input }) => {
					return await innerFn({ input: { value: 42 } });
				});

			// Call outer function and expect error
			await expect(async () => {
				await outerFn({ input: { id: 'test' } });
			}).rejects.toThrow('Inner error');

			// Verify error was only logged once
			expect(logger.error).toHaveBeenCalledTimes(1);
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'Inner error' }),
				expect.any(Object)
			);
		});

		// Test: Error handling with multiple levels of nesting
		test('should handle errors through multiple levels of nesting - only calling logger.error once', async () => {
			// Create three levels of nested functions
			const level3Fn = customFn.meta({ key: 'level3' }).mutation(async () => {
				throw new Error('Deep error');
			});

			const level2Fn = customFn.meta({ key: 'level2' }).mutation(async () => {
				return await level3Fn({});
			});

			const level1Fn = customFn.meta({ key: 'level1' }).mutation(async () => {
				return await level2Fn({});
			});

			// Call top-level function and expect error to propagate
			await expect(async () => {
				await level1Fn({});
			}).rejects.toThrow('Deep error');

			// Should only log once despite three levels
			expect(logger.error).toHaveBeenCalledTimes(1);
		});
	});

	// Add new describe block for testing debug logging
	describe('Debug Logging', () => {
		beforeEach(() => {
			logger.cleanup();
		});

		test('should log debug information before and after function call', async () => {
			const result = await createUser({ input: { name: 'Debug Test' } });

			// Verify debug was called twice (before and after)
			expect(logger.debug).toHaveBeenCalledTimes(2);

			// Verify first call logs the function call with meta and input
			expect(logger.debug).toHaveBeenNthCalledWith(1, 'calling fn', {
				key: 'createUser',
				input: { name: 'Debug Test' },
			});

			// Verify second call logs the result
			expect(logger.debug).toHaveBeenNthCalledWith(2, 'fn result', result);
		});

		test('should include metadata when logging debug info', async () => {
			const customMetaFn = customFn
				.meta({ key: 'customMetaFn', role: 'admin', priority: 'high' })
				.mutation(async () => 'success');

			await customMetaFn({});

			// Check that the metadata was included in the debug log
			expect(logger.debug).toHaveBeenCalledWith(
				'calling fn',
				expect.objectContaining({
					key: 'customMetaFn',
					role: 'admin',
					priority: 'high',
				})
			);
		});

		test('should log debug even when function throws an error', async () => {
			const errorFn = customFn.meta({ key: 'errorFn' }).mutation(async () => {
				throw new Error('Test error');
			});

			await expect(errorFn({})).rejects.toThrow('Test error');

			// Should still log the initial debug call
			expect(logger.debug).toHaveBeenCalledWith(
				'calling fn',
				expect.objectContaining({
					key: 'errorFn',
				})
			);

			// Should not log a successful result
			expect(logger.debug).toHaveBeenCalledTimes(1);

			// Should log the error instead
			expect(logger.error).toHaveBeenCalledTimes(1);
		});

		test('should log complex input and output data correctly', async () => {
			const complexFn = customFn
				.meta({ key: 'complexFn' })
				.input({
					user: z.object({
						id: z.string(),
						profile: z.object({
							name: z.string(),
							age: z.number(),
						}),
					}),
					options: z.object({
						includeDetails: z.boolean(),
					}),
				})
				.mutation(async ({ input }) => {
					return {
						userId: input.user.id,
						userName: input.user.profile.name,
						details: input.options.includeDetails
							? { age: input.user.profile.age }
							: null,
					};
				});

			const complexInput = {
				user: {
					id: '123',
					profile: {
						name: 'John',
						age: 30,
					},
				},
				options: {
					includeDetails: true,
				},
			};

			const result = await complexFn({ input: complexInput });

			// Verify debug logged the complex input
			expect(logger.debug).toHaveBeenNthCalledWith(1, 'calling fn', {
				key: 'complexFn',
				input: complexInput,
			});

			// Verify debug logged the complex output
			expect(logger.debug).toHaveBeenNthCalledWith(2, 'fn result', result);
		});
	});

	// Add new describe block for privacy tests
	describe('Privacy and Sensitive Data', () => {
		beforeEach(() => {
			logger.cleanup();
		});

		test('should redact sensitive fields in input logging', async () => {
			// Create a schema with some sensitive fields
			const userSchema = z.object({
				id: z.string(),
				email: sensitive(z.string().email()),
				name: z.string(),
				password: sensitive(z.string()),
			});

			const createSensitiveUser = customFn
				.meta({ key: 'createSensitiveUser' })
				.input(userSchema)
				.output(z.object({ id: z.string(), name: z.string() }))
				.mutation(async ({ input }) => {
					return { id: input.id, name: input.name };
				});

			// Call with data containing sensitive fields
			await createSensitiveUser({
				input: {
					id: 'user123',
					email: 'test@example.com',
					name: 'Test User',
					password: 'supersecret',
				},
			});

			// Check that debug logs have redacted sensitive fields
			expect(logger.debug).toHaveBeenCalledWith('calling fn', {
				key: 'createSensitiveUser',
				input: {
					id: 'user123',
					email: '[REDACTED]',
					name: 'Test User',
					password: '[REDACTED]',
				},
			});
		});

		test('should redact nested sensitive fields', async () => {
			// Create a schema with nested sensitive fields
			const nestedSchema = z.object({
				user: z.object({
					id: z.string(),
					contact: z.object({
						email: sensitive(z.string().email()),
						phone: sensitive(z.string().optional()),
					}),
				}),
				preferences: z.object({
					theme: z.string(),
					notifications: z.boolean(),
				}),
			});

			const nestedFn = customFn
				.meta({ key: 'nestedFn' })
				.input(nestedSchema)
				.mutation(async ({ input }) => {
					return { success: true };
				});

			// Call with nested data
			await nestedFn({
				input: {
					user: {
						id: 'user456',
						contact: {
							email: 'nested@example.com',
							phone: '+1234567890',
						},
					},
					preferences: {
						theme: 'dark',
						notifications: true,
					},
				},
			});

			// Verify nested sensitive fields are redacted
			expect(logger.debug).toHaveBeenCalledWith(
				'calling fn',
				expect.objectContaining({
					input: {
						user: {
							id: 'user456',
							contact: {
								email: '[REDACTED]',
								phone: '[REDACTED]',
							},
						},
						preferences: {
							theme: 'dark',
							notifications: true,
						},
					},
				})
			);
		});

		test('should redact sensitive fields in error logging', async () => {
			// Create a function that will throw an error
			const errorFn = customFn
				.meta({ key: 'errorWithSensitiveData' })
				.input({
					userId: z.string(),
					apiKey: sensitive(z.string()),
					credentials: sensitive(
						z.object({
							username: z.string(),
							password: z.string(),
						})
					),
				})
				.mutation(async ({ input }) => {
					throw new Error('Something went wrong');
				});

			// Call and catch the error
			await expect(
				errorFn({
					input: {
						userId: 'user789',
						apiKey: 'sk_test_12345',
						credentials: {
							username: 'admin',
							password: 'adminpass',
						},
					},
				})
			).rejects.toThrow('Something went wrong');

			// Verify sensitive data is redacted in error logs
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'Something went wrong' }),
				expect.objectContaining({
					input: {
						userId: 'user789',
						apiKey: '[REDACTED]',
						credentials: '[REDACTED]',
					},
				})
			);
		});

		test('should redact sensitive arrays', async () => {
			// Test with arrays containing sensitive data
			const arraySchema = z.object({
				ids: z.array(z.string()),
				secretTokens: sensitive(z.array(z.string())),
				users: z.array(
					z.object({
						id: z.string(),
						token: sensitive(z.string()),
					})
				),
			});

			const arrayFn = customFn
				.meta({ key: 'arrayFn' })
				.input(arraySchema)
				.mutation(async ({ input }) => {
					return { processed: input.ids.length };
				});

			await arrayFn({
				input: {
					ids: ['id1', 'id2'],
					secretTokens: ['secret1', 'secret2'],
					users: [
						{ id: 'u1', token: 'tok_1' },
						{ id: 'u2', token: 'tok_2' },
					],
				},
			});

			// Check that arrays are properly redacted
			expect(logger.debug).toHaveBeenCalledWith(
				'calling fn',
				expect.objectContaining({
					input: {
						ids: ['id1', 'id2'],
						secretTokens: '[REDACTED]',
						users: [
							{ id: 'u1', token: '[REDACTED]' },
							{ id: 'u2', token: '[REDACTED]' },
						],
					},
				})
			);
		});

		test('should mark entire output as sensitive', async () => {
			// Create a function with sensitive output
			const sensitiveFn = customFn
				.input({ query: z.string() })
				.output(
					sensitive(
						z.object({
							results: z.array(
								z.object({
									id: z.string(),
									confidential: z.boolean(),
								})
							),
						})
					)
				)
				.meta({ key: 'sensitiveFn' })
				.mutation(async ({ input }) => {
					return {
						results: [
							{ id: 'res1', confidential: true },
							{ id: 'res2', confidential: false },
						],
					};
				});

			const result = await sensitiveFn({ input: { query: 'test' } });

			// Output should be normal for the return value
			expect(result).toEqual({
				results: [
					{ id: 'res1', confidential: true },
					{ id: 'res2', confidential: false },
				],
			});

			// But redacted in logs
			expect(logger.debug).toHaveBeenLastCalledWith('fn result', '[REDACTED]');
		});
	});

	describe('Force Schema Validation Option', () => {
		beforeEach(() => {
			logger.cleanup();
		});

		test('should validate input when forceSchemaValidation is enabled', async () => {
			// Create function with forceSchemaValidation enabled
			const validateFn = customFn
				.meta({ key: 'validateFn' })
				.options({ forceSchemaValidation: true })
				.input({ id: z.string(), count: z.number() })
				.mutation(async ({ input }) => {
					return { success: true, id: input.id, count: input.count };
				});

			// Should throw for invalid input
			await expect(async () => {
				await validateFn({
					input: { id: '123', count: 'not-a-number' as any },
				});
			}).rejects.toThrow(/Invalid input/);

			// Should log the validation error
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					code: 'INVALID_INPUT',
					message: expect.stringContaining('Expected number'),
				}),
				expect.any(Object)
			);

			// Should work with valid input
			const result = await validateFn({ input: { id: '123', count: 42 } });
			expect(result).toEqual({ success: true, id: '123', count: 42 });
		});

		test('should validate output when forceSchemaValidation is enabled', async () => {
			// Create function that returns invalid output
			const badOutputFn = customFn
				.meta({ key: 'badOutputFn' })
				.options({ forceSchemaValidation: true })
				.input(z.any())
				.output({ value: z.number() })
				.mutation(async () => {
					return { value: 'not-a-number' as any };
				});

			// Should throw for invalid output
			await expect(async () => {
				await badOutputFn({} as any);
			}).rejects.toThrow(/Invalid output/);

			// Should log the output validation error
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					code: 'INVALID_OUTPUT',
					message: expect.stringContaining('Expected number'),
				}),
				expect.any(Object)
			);
		});

		test('should not validate schemas by default', async () => {
			// Create function without forceSchemaValidation (default behavior)
			const defaultFn = customFn
				.meta({ key: 'defaultFn' })
				.input({ id: z.string() })
				.mutation(async ({ input }) => {
					return { success: true, id: input.id };
				});

			// Should NOT throw for invalid input
			const result = await defaultFn({ input: { id: 123 as any } });
			expect(result).toEqual({ success: true, id: 123 });
			expect(logger.error).not.toHaveBeenCalled();
		});

		test('should work with global forceSchemaValidation option', async () => {
			// Create a baseFn with global forceSchemaValidation
			const validatingBaseFn = baseFn().options({
				forceSchemaValidation: true,
				onError: (opts) => {
					logger.error(opts.error, {
						input: opts.input,
						meta: opts.meta,
					});
				},
			});

			// All functions created with this base should validate
			const fn1 = validatingBaseFn
				.input({ value: z.number() })
				.mutation(async ({ input }) => input.value * 2);

			const fn2 = validatingBaseFn
				.input({ name: z.string() })
				.mutation(async ({ input }) => `Hello, ${input.name}!`);

			// Both should throw for invalid input
			await expect(
				fn1({ input: { value: 'not-a-number' as any } })
			).rejects.toThrow();
			await expect(fn2({ input: { name: 123 as any } })).rejects.toThrow();
		});

		test('should allow overriding global forceSchemaValidation for specific functions', async () => {
			// Create a baseFn with global forceSchemaValidation
			const validatingBaseFn = baseFn().options({
				forceSchemaValidation: true,
				onError: (opts) => {
					logger.error(opts.error, {
						input: opts.input,
						meta: opts.meta,
					});
				},
			});

			// Function that overrides the global setting
			const nonValidatingFn = validatingBaseFn
				.options({ forceSchemaValidation: false })
				.input(z.object({ value: z.number() }))
				.mutation(async ({ input }) => {
					// // Log what we're actually receiving to help debug
					// console.log('Input value type:', typeof input.value);
					// // For the test purpose, stringifying the input to see raw value
					// console.log('Input value:', JSON.stringify(input));
					// Let's explicitly check if the input is not being validated
					return {
						valueType: typeof input.value,
						rawValue: String(input.value),
					};
				});
			// Should NOT throw for invalid input
			await expect(
				nonValidatingFn({ input: { value: 'invalid' as any } })
			).resolves.toMatchObject({
				valueType: 'string',
				rawValue: 'invalid',
			});
		});
	});

	// Add new describe block for testing logging prevention
	describe('Logging Prevention', () => {
		beforeEach(() => {
			logger.cleanup();
		});

		test('should not log debug information when preventLogging is true', async () => {
			// Create a function with preventLogging enabled
			const silentFn = customFn
				.meta({ key: 'silentFn' })
				.options({ preventLogging: true })
				.input({ data: z.string() })
				.mutation(async ({ input }) => {
					return { processed: input.data.toUpperCase() };
				});

			// Call the function
			const result = await silentFn({ input: { data: 'test data' } });

			// Verify result is correct
			expect(result).toEqual({ processed: 'TEST DATA' });

			// Verify NO debug logs were created
			expect(logger.debug).not.toHaveBeenCalled();
		});

		test('should still log errors even when preventLogging is true', async () => {
			// Create a function that will throw an error but with preventLogging
			const errorSilentFn = customFn
				.meta({ key: 'errorSilentFn' })
				.options({ preventLogging: true })
				.mutation(async () => {
					throw new Error('Error in silent function');
				});

			// Call and expect error
			await expect(errorSilentFn({})).rejects.toThrow(
				'Error in silent function'
			);

			// Debug logs should be suppressed
			expect(logger.debug).not.toHaveBeenCalled();

			// But error logs should still happen
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'Error in silent function' }),
				expect.any(Object)
			);
		});

		test('should handle nested calls with different logging settings', async () => {
			// A silent inner function
			const silentInnerFn = customFn
				.meta({ key: 'silentInnerFn' })
				.options({ preventLogging: true })
				.input({ value: z.number() })
				.mutation(async ({ input }) => {
					return { result: input.value * 2 };
				});

			// A normal outer function that calls the silent inner function
			const outerFn = customFn
				.meta({ key: 'outerFn' })
				.input({ multiplier: z.number() })
				.mutation(async ({ input }) => {
					const inner = await silentInnerFn({
						input: { value: input.multiplier },
					});
					return { finalResult: inner.result + 1 };
				});

			// Call the outer function
			const result = await outerFn({ input: { multiplier: 5 } });

			// Verify result
			expect(result).toEqual({ finalResult: 11 });

			// Only outer function should be logged, not the inner one
			expect(logger.debug).toHaveBeenCalledTimes(2); // Once before, once after
			expect(logger.debug).toHaveBeenCalledWith(
				'calling fn',
				expect.objectContaining({ key: 'outerFn' })
			);
			expect(logger.debug).not.toHaveBeenCalledWith(
				'calling fn',
				expect.objectContaining({ key: 'silentInnerFn' })
			);
		});
	});

	describe('Function Callbacks as Input/Output', () => {
		beforeEach(() => {
			logger.cleanup();
		});

		test('should support callback function as input parameter', async () => {
			// Define a schema that accepts a callback function
			const callbackFn = customFn
				.meta({ key: 'callbackFn' })
				.input({
					name: z.string(),
					transform: z
						.function()
						.args(z.string())
						.returns(z.string())
						.optional(),
				})
				.mutation(async ({ input }) => {
					const result = input.name.toUpperCase();
					// Apply transform if provided
					if (input.transform) {
						return input.transform(result);
					}
					return result;
				});

			// Call with a callback function
			const result = await callbackFn({
				input: {
					name: 'test',
					transform: (str: string) => `transformed: ${str}`,
				},
			});

			expect(result).toBe('transformed: TEST');

			// Verify debug logs properly handled the function
			expect(logger.debug).toHaveBeenCalledWith('calling fn', {
				key: 'callbackFn',
				input: {
					name: 'test',
					transform: '[Function]',
				},
			});
		});

		test('should support callback function in output', async () => {
			// Define a schema that returns a function
			const functionReturnFn = customFn
				.meta({ key: 'functionReturnFn' })
				.input({ prefix: z.string() })
				.output({
					formatter: z.function().args(z.string()).returns(z.string()),
					metadata: z.object({
						creator: z.string(),
					}),
				})
				.mutation(async ({ input }) => {
					return {
						formatter: (str: string) => `${input.prefix}: ${str}`,
						metadata: {
							creator: 'system',
						},
					};
				});

			// Get the function from the result
			const result = await functionReturnFn({ input: { prefix: 'Hello' } });

			// Test the returned function
			expect(typeof result.formatter).toBe('function');
			expect(result.formatter('world')).toBe('Hello: world');

			// Verify debug logs properly handled the function in output
			expect(logger.debug).toHaveBeenCalledWith('fn result', {
				formatter: '[Function]',
				metadata: {
					creator: 'system',
				},
			});
		});

		test('should validate function parameters with zod schema', async () => {
			// Create a function with validation for callback parameters
			const validatedCallbackFn = customFn
				.meta({ key: 'validatedCallback' })
				.options({ forceSchemaValidation: true })
				.input({
					processor: z.function().args(z.number()).returns(z.number()),
				})
				.mutation(async ({ input }) => {
					return input.processor(42);
				});

			// Valid function should work
			const result = await validatedCallbackFn({
				input: {
					processor: (num: number) => num * 2,
				},
			});
			expect(result).toBe(84);

			// Invalid function signature should fail with schema validation
			await expect(async () => {
				await validatedCallbackFn({
					input: {
						processor: 'not a function' as any,
					},
				});
			}).rejects.toThrow(/Invalid input/);
		});

		test('should handle nested functions in objects and arrays', async () => {
			// Create a function with complex nested structure containing functions
			const nestedFunctionsFn = customFn
				.meta({ key: 'nestedFunctions' })
				.input({
					handlers: z.array(
						z.object({
							id: z.string(),
							process: z.function().args(z.string()).returns(z.string()),
						})
					),
				})
				.mutation(async ({ input }) => {
					return input.handlers.map((handler) => ({
						id: handler.id,
						result: handler.process(`processed-${handler.id}`),
					}));
				});

			// Call with array of handlers
			const result = await nestedFunctionsFn({
				input: {
					handlers: [
						{
							id: 'h1',
							process: (str: string) => str.toUpperCase(),
						},
						{
							id: 'h2',
							process: (str: string) => `${str}!`,
						},
					],
				},
			});

			expect(result).toEqual([
				{ id: 'h1', result: 'PROCESSED-H1' },
				{ id: 'h2', result: 'processed-h2!' },
			]);

			// Verify debug logs handled the nested functions
			expect(logger.debug).toHaveBeenCalledWith('calling fn', {
				key: 'nestedFunctions',
				input: {
					handlers: [
						{ id: 'h1', process: '[Function]' },
						{ id: 'h2', process: '[Function]' },
					],
				},
			});
		});
	});

	describe('Stack Trace Preservation', () => {
		beforeEach(() => {
			logger.cleanup();
		});

		test('should preserve original error stack trace', async () => {
			// Create a function that throws an error with a known stack
			const errorFn = customFn
				.meta({ key: 'stackTraceErrorFn' })
				.mutation(async () => {
					// Create a nested function with a distinctive name that should appear in the stack
					function throwDistinctiveError() {
						throw new Error('Original error');
					}

					// Call the nested function to get its name in the stack trace
					throwDistinctiveError();
				});

			// Capture the error and its stack
			let capturedError: Error | null = null;
			try {
				await errorFn({});
			} catch (error) {
				capturedError = error as Error;
			}

			// Verify we caught the error
			expect(capturedError).not.toBeNull();
			expect(capturedError!.message).toBe('Original error');

			// The stack trace should contain the function name where the error was thrown
			expect(capturedError!.stack).toContain('throwDistinctiveError');

			// Verify the logger was called with the error that has the same stack trace
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					message: 'Original error',
				}),
				expect.any(Object)
			);

			// Get the error object that was passed to logger.error
			const loggedError = (logger.error as any).mock.calls[0][0];

			// The stack of the logged error should match the captured error's stack
			expect(loggedError.stack).toEqual(capturedError!.stack);
		});

		test('should not duplicate stack frames when wrapping errors', async () => {
			const deepErrorFn = customFn
				.meta({ key: 'deepErrorFn' })
				.mutation(async () => {
					function deepFunction() {
						function veryDeepFunction() {
							throw new Error('Deep error');
						}
						veryDeepFunction();
					}
					deepFunction();
				});

			let capturedError: Error | null = null;
			try {
				await deepErrorFn({});
			} catch (error) {
				capturedError = error as Error;
			}

			// Check that each frame from the original stack appears only once
			const stackLines = capturedError!.stack!.split('\n');
			const frameSet = new Set(stackLines);

			// If frames were duplicated, the set size would be smaller than the array length
			expect(frameSet.size).toBe(stackLines.length);

			// Check that the logger received the error with the same non-duplicated stack
			const loggedError = (logger.error as any).mock.calls[0][0];
			expect(loggedError.stack).toEqual(capturedError!.stack);
		});

		test('should maintain FnError specific data when preserving stack traces', async () => {
			const customErrorFn = customFn
				.meta({ key: 'customErrorFn' })
				.mutation(async () => {
					throw new FnError({
						code: 'NOT_FOUND',
						message: 'Resource not found',
						meta: { resourceId: '123' },
					});
				});

			let capturedError: FnError | null = null;
			try {
				await customErrorFn({});
			} catch (error) {
				capturedError = error as FnError;
			}

			// Verify the FnError properties are maintained
			expect(capturedError!.code).toBe('NOT_FOUND');
			expect(capturedError!.meta).toHaveProperty('resourceId', '123');

			// Check that the error logged to the logger has the same properties
			const loggedError = (logger.error as any).mock.calls[0][0];
			expect(loggedError.code).toBe('NOT_FOUND');
			expect(loggedError.meta).toHaveProperty('resourceId', '123');
		});
	});

	describe('Error Logging Behavior', () => {
		beforeEach(() => {
			logger.cleanup();
			// Spy on console methods to verify they're not called excessively
			vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.spyOn(console, 'log').mockImplementation(() => {});
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		test('should not flood console with duplicate logs', async () => {
			const floodingFn = customFn
				.meta({ key: 'floodingFn' })
				.mutation(async () => {
					throw new Error('This should log only once');
				});

			// Call the function and catch the error
			await expect(floodingFn({})).rejects.toThrow('This should log only once');

			// Verify error was logged exactly once via our logger
			expect(logger.error).toHaveBeenCalledTimes(1);

			// Verify console.error wasn't called directly (which would cause duplication)
			expect(console.error).not.toHaveBeenCalled();
		});

		test('should provide concise error information for debugging', async () => {
			const verboseFn = customFn
				.meta({ key: 'verboseFn' })
				.input({
					userId: z.string(),
					details: z.object({
						preferences: z.array(z.string()),
						settings: z.record(z.string(), z.any()),
					}),
				})
				.mutation(async ({ input }) => {
					throw new Error('Operation failed');
				});

			// Call with complex input
			await expect(
				verboseFn({
					input: {
						userId: 'user123',
						details: {
							preferences: ['dark', 'compact'],
							settings: {
								notifications: true,
								theme: 'blue',
								advanced: { feature1: true, feature2: false },
							},
						},
					},
				})
			).rejects.toThrow('Operation failed');

			// Verify the logged error contains just the essential information
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'Operation failed' }),
				expect.objectContaining({
					input: expect.anything(),
					meta: expect.objectContaining({ key: 'verboseFn' }),
				})
			);

			// The logged error should be a plain object that's easy to read
			const loggedErrorObj = (logger.error as any).mock.calls[0][0];
			const errorSerializable = JSON.stringify(loggedErrorObj);
			expect(errorSerializable).toBeTruthy(); // Can be serialized
		});

		test('should handle circular references in error objects', async () => {
			const circularFn = customFn
				.meta({ key: 'circularFn' })
				.mutation(async () => {
					// Create an object with circular references
					const circular: any = { name: 'circular' };
					circular.self = circular;

					// Create an error with circular reference in meta
					throw new FnError({
						code: 'BAD_REQUEST',
						message: 'Contains circular reference',
						meta: { circular },
					});
				});

			// Should not crash when handling the circular error
			await expect(circularFn({})).rejects.toThrow(
				'Contains circular reference'
			);

			// Should have safely logged the error
			expect(logger.error).toHaveBeenCalled();
		});
	});
});
