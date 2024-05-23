import { describe, expect, test } from 'vitest';
import { store } from '../../src';
import { act, render, screen, waitFor } from '@testing-library/react';

const WindowStore = () => {
	const $window = store<Window | undefined>(undefined);

	$window.onChange((state) => {
		// console.log('state', state);

		const w = state?.window.innerWidth;
		const h = state?.window.innerHeight;

		console.log('w', w);
		console.log('h', h);
	});
	const windowValue = $window.use();

	const w = windowValue?.window.innerWidth;
	const h = windowValue?.window.innerHeight;

	return (
		<div>
			<p data-testid="innerWidth">{windowValue?.window.innerWidth}</p>
			<p data-testid="innerHeight">{windowValue?.window.innerHeight}</p>
			<button
				data-testid="set-window"
				onClick={() => {
					const myWindow = global.window as Window;
					// console.log('myWindow', myWindow);
					// $window.set(global.window);
					// $window.set(global.window);
				}}
			>
				set window
			</button>
		</div>
	);
};

describe.only('state with non-draftable objects', () => {
	test('handle window object', async () => {
		const { getByTestId } = render(<WindowStore />);

		// Get the initial values of innerWidth and innerHeight
		const initialInnerWidth = screen.getByTestId('innerWidth').textContent;
		const initialInnerHeight = screen.getByTestId('innerHeight').textContent;

		// Click the "Update Window" button
		const setWindowButton = screen.getByTestId('set-window');
		expect(setWindowButton).toBeTruthy();
		act(() => {
			screen.getByText('set window').click();
		});

		// Get the updated values of innerWidth and innerHeight
		const updatedInnerWidth = screen.getByTestId('innerWidth').textContent;
		const updatedInnerHeight = screen.getByTestId('innerHeight').textContent;

		// Assert that the values have been updated correctly
		expect(updatedInnerWidth).toBe('1210');
		expect(updatedInnerHeight).toBe('720');
		expect(updatedInnerWidth).not.toBe(initialInnerWidth);
		expect(updatedInnerHeight).not.toBe(initialInnerHeight);
	});

	// Add more tests for other exotic objects as needed
});
const WindowStoreOld = () => {
	const $window = store<{ _: Window | undefined }>({ _: undefined });

	// $window.onChange((state) => {
	// 	console.log('state', state);

	// 	const w = state?._.window.innerWidth;
	// 	const h = state?._.window.innerHeight;

	// 	console.log('w', w);
	// 	console.log('h', h);
	// });
	const windowValue = $window.use()._;

	const w = windowValue?.window.innerWidth;
	const h = windowValue?.window.innerHeight;

	return (
		<div>
			<p data-testid="innerWidth">{windowValue?.window.innerWidth}</p>
			<p data-testid="innerHeight">{windowValue?.window.innerHeight}</p>
			<button
				data-testid="set-window"
				onClick={() => {
					const myWindow = global.window as Window;
					// console.log('myWindow', myWindow);
					$window._.set(global.window);
				}}
			>
				set window
			</button>
		</div>
	);
};

describe('state with non-draftable objects OLD', () => {
	test('handle window object', async () => {
		const { getByTestId } = render(<WindowStoreOld />);

		// Get the initial values of innerWidth and innerHeight
		const initialInnerWidth = screen.getByTestId('innerWidth').textContent;
		const initialInnerHeight = screen.getByTestId('innerHeight').textContent;

		// Click the "Update Window" button
		const setWindowButton = screen.getByTestId('set-window');
		expect(setWindowButton).toBeTruthy();
		act(() => {
			screen.getByText('set window').click();
		});

		waitFor(() => {
			// Get the updated values of innerWidth and innerHeight
			const updatedInnerWidth = screen.getByTestId('innerWidth').textContent;
			const updatedInnerHeight = screen.getByTestId('innerHeight').textContent;

			// Assert that the values have been updated correctly
			expect(updatedInnerWidth).toBe('12g80');
			expect(updatedInnerHeight).toBe('720');
			expect(updatedInnerWidth).not.toBe(initialInnerWidth);
			expect(updatedInnerHeight).not.toBe(initialInnerHeight);
		});
	});

	// Add more tests for other exotic objects as needed
});
