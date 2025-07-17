import { describe, it, expect } from 'vitest';
import { helloWorld } from '../src';

describe('@ream/fn', () => {
	it('test suite should be running correctly', () => {
		expect(helloWorld()).toBe('Hello, world!');
	});
});
