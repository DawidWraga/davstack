import { vi } from 'vitest';

// howler.mock.ts
export const HowlMock = vi.fn().mockImplementation((options) => ({
	play: vi.fn(),
	pause: vi.fn(),
	stop: vi.fn(),
	// Add other methods and properties as needed
}));

export const HowlerMock = {
	volume: vi.fn(),
	// Add other methods and properties as needed
};
