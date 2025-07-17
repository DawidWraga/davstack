import { test, expect, describe } from 'vitest';
import { initProcedureFactory } from '../src/utils/init-procedure-factory';

describe('initProcedureFactory', () => {
	test('should create a hello world test', () => {
		// Simple hello world test to verify the test setup works
		const message = 'Hello World';
		expect(message).toBe('Hello World');
	});

	test('should initialize a procedure factory', () => {
		// Mock procedure builder
		const mockProcedureBuilder = {} as any;

		// Create factory
		const factory = initProcedureFactory(mockProcedureBuilder);

		// Verify factory is a function
		expect(typeof factory).toBe('function');
	});
});
