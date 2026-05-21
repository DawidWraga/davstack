import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
	HowlConstructorType,
	lazyImportHowlerConstructor,
} from '../src/howler-lazy';
import { HowlerMock, HowlMock } from './howler.mock';

vi.mock('howler', () => ({
  Howl: HowlMock,
  Howler: HowlerMock,
}));


describe('lazy howler', () => {
	it('should initialize Howler constructor', async () => {
		const Howler = await lazyImportHowlerConstructor();
		expect(Howler).toBeDefined();

		expectTypeOf(Howler).toEqualTypeOf<HowlConstructorType>();
	});
});
