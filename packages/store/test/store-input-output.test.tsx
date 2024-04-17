import { act, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { store } from '../src';

const testIds = {
	greeting: 'greeting',
	doubledCount: 'doubled-count',
	tripleCount: 'triple-count',
};

const getUi = ({ getByTestId, ...rest }: ReturnType<typeof render>) => {
	return {
		getByTestId,
		...rest,
		get greeting() {
			return getByTestId(testIds.greeting).textContent;
		},
		get doubledCount() {
			return getByTestId(testIds.doubledCount).textContent;
		},
		get tripleCount() {
			return getByTestId(testIds.tripleCount).textContent;
		},
	};
};

describe('store with input/output options', () => {
	test('input option', () => {
		const userStore = store().input({ name: '' });
		// .state({ count: 0 })
		// .computed((store) => ({
		// 	greeting: () => `Hello, ${store.name}!`,
		// }));

		expect(userStore.name).toBe('');

		// const User = () => {
		// 	const greeting = userStore.greeting.use();
		// 	return <div data-testid={testIds.greeting}>{greeting}</div>;
		// };

		// const ui = getUi(render(<User />));
		// expect(ui.greeting).toBe('Hello, !');

		// const userStore2 = userStore.create({
		// 	count: 0,
		// 	name: 'John',
		// });
		// const ui2 = getUi(render(<User />));
		// expect(ui2.greeting).toBe('Hello, John!');
	});

	// test('output option', () => {
	// 	const countStore = store()
	// 		.state({ count: 0 })
	// 		.computed((store) => ({
	// 			doubled: () => store.count.use() * 2,
	// 			tripled: () => store.count.use() * 3,
	// 		}))
	// 		.output((store) => ({
	// 			doubledCount: store.doubled,
	// 		}));

	// 	const Counter = () => {
	// 		const doubled = countStore.doubledCount.use();
	// 		// @ts-expect-error
	// 		const tripled = countStore.tripled.use();
	// 		return (
	// 			<>
	// 				<div data-testid={testIds.doubledCount}>Doubled: {doubled}</div>
	// 				<div data-testid={testIds.tripleCount}>Tripled: {tripled}</div>
	// 			</>
	// 		);
	// 	};

	// 	const ui = getUi(render(<Counter />));
	// 	expect(ui.doubledCount).toBe('Doubled: 0');
	// 	expect(ui.tripleCount).toBe('Tripled: undefined');
	// });
});
