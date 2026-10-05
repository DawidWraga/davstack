import { describe, expect, test } from "vitest";
import { tryCatch } from "../src";

describe("tryCatch", () => {
	test("resolves a promise to { data, error: null }", async () => {
		const { data, error } = await tryCatch(Promise.resolve(42));
		expect(data).toBe(42);
		expect(error).toBeNull();
	});

	test("catches a rejected promise into { data: null, error }", async () => {
		const boom = new Error("boom");
		const { data, error } = await tryCatch(Promise.reject(boom));
		expect(data).toBeNull();
		expect(error).toBe(boom);
	});

	test("supports a thunk returning a value", async () => {
		const { data, error } = await tryCatch(() => "hello");
		expect(data).toBe("hello");
		expect(error).toBeNull();
	});

	test("supports a thunk returning a promise", async () => {
		const { data, error } = await tryCatch(async () => "async-hello");
		expect(data).toBe("async-hello");
		expect(error).toBeNull();
	});

	test("catches a synchronous throw from a thunk", async () => {
		const boom = new Error("sync boom");
		const { data, error } = await tryCatch(() => {
			throw boom;
		});
		expect(data).toBeNull();
		expect(error).toBe(boom);
	});

	test("catches an async throw from a thunk", async () => {
		const boom = new Error("async boom");
		const { data, error } = await tryCatch(async () => {
			throw boom;
		});
		expect(data).toBeNull();
		expect(error).toBe(boom);
	});
});
