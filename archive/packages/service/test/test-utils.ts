import { vi, type Mock } from 'vitest';
/**
 * Temporarily replaces `console.log` with a mock function and passes it directly to the callback.
 *
 * @param callback - The function to execute with a mocked `console.log`.
 *
 * !Warning: Make sure to await the expect(mockConsoleLog)... inside the callback. Otherwise will not work as expected.
 *
 * @example
 * ```typescript
 * await silentTestConsoleLog(async (mockConsoleLog) => {
 *   console.log("This message will be intercepted by mockConsoleLog.");
 *   expect(mockConsoleLog).toHaveBeenCalledWith("This message will be intercepted by mockConsoleLog.");
 * });
 * ```
 */
export async function silentTestConsoleLog(
	callback: (mockConsoleLog: Mock) => any | Promise<any>
) {
	const originalConsoleLog = console.log;
	const mockConsoleLog = vi.fn();
	console.log = mockConsoleLog;
	await callback(mockConsoleLog);
	console.log = originalConsoleLog;
}

/**
 * Temporarily replaces `console.error` with a mock function and passes it directly to the callback.
 *
 * @param callback - The function to execute with a mocked `console.error`.
 *
 *  !Warning: Make sure to await the expect(mockConsoleLog)... inside the callback. Otherwise will not work as expected.
 *
 * @example
 * ```typescript
 * await silentTestConsoleError(async (mockError) => {
 *   console.error("This error will be intercepted by mockError.");
 *   expect(mockError).toHaveBeenCalledWith("This error will be intercepted by mockError.");
 * });
 * ```
 */
export async function silentTestConsoleError(
	callback: (mockConsoleError: Mock) => any | Promise<any>
) {
	const originalConsoleError = console.error;
	const mockConsoleError = vi.fn();
	console.error = mockConsoleError;
	await callback(mockConsoleError);
	console.error = originalConsoleError;
}
