/* eslint-disable no-unused-vars */
// import { render, RenderOptions, RenderResult } from '@testing-library/react';
// import { ReactNode, useRef } from 'react';

// export const defineTestUi = <
// 	TRenderExtraProps extends object,
// 	TTestIds extends Record<string, string>,
// 	TGetUi extends (renderResult: RenderResult & { testIds: TTestIds }) => object,
// >(opts: {
// 	ui: TGetUi;
// 	testIds: TTestIds;
// 	render?: (data: { testIds: TTestIds } & TRenderExtraProps) => ReactNode;
// 	renderOpts?: RenderOptions;
// }) => {
// 	type RenderUiProps = TRenderExtraProps & { testIds?: TTestIds };
// 	const renderUi = (props?: RenderUiProps, renderOpts?: RenderOptions) => {
// 		const firstArg = opts.render({ testIds: opts.testIds, ...props } as any);

// 		const renderResults = render(firstArg as any, renderOpts);
// 		return {
// 			testIds: opts.testIds,

// 			...renderResults,
// 			...opts.ui({ ...renderResults, testIds: opts.testIds }),
// 		};
// 	};

// 	type RenderUiFn = (
// 		(data: { testIds: TTestIds } & TRenderExtraProps) => ReactNode,
// 		renderOpts?: RenderOptions
// 	) => ReturnType<TGetUi> & {
// 		testIds: TTestIds;
// 	} & RenderResult;

// 	return {
// 		testIds: opts.testIds,
// 		render: renderUi as RenderUiFn,
// 	};
// };
// export const defineTestUi = <
// 	TRenderExtraProps extends object,
// 	TTestIds extends Record<string, string>,
// 	TGetUi extends (renderResult: RenderResult & { testIds: TTestIds }) => object,
// >(opts: {
// 	ui: TGetUi;
// 	testIds: TTestIds;
// 	render?: (data: { testIds: TTestIds } & TRenderExtraProps) => ReactNode;
// 	renderOpts?: RenderOptions;
// }) => {
// 	type RenderUiProps = TRenderExtraProps & { testIds?: TTestIds };
// 	const renderUi = (props?: RenderUiProps, renderOpts?: RenderOptions) => {
// 		const firstArg = opts.render({ testIds: opts.testIds, ...props } as any);

// 		const renderResults = render(firstArg as any, renderOpts);
// 		return {
// 			testIds: opts.testIds,

// 			...renderResults,
// 			...opts.ui({ ...renderResults, testIds: opts.testIds }),
// 		};
// 	};

// 	type RenderUiFn = (
// 		props?: TRenderExtraProps,
// 		renderOpts?: RenderOptions
// 	) => ReturnType<TGetUi> & {
// 		testIds: TTestIds;
// 	} & RenderResult;

// 	return {
// 		testIds: opts.testIds,
// 		render: renderUi as RenderUiFn,
// 	};
// };

// export const createTestUi = <
// 	TRenderExtraProps extends Record<string, string>,
// 	TTestIds extends Record<string, string>,
// 	TGetUi extends (renderResult: RenderResult & { testIds: TTestIds }) => object,
// >(opts: {
// 	ui: TGetUi;
// 	testIds: TTestIds;
// 	render: (data: { testIds: TTestIds } & TRenderExtraProps) => ReactNode;
// 	renderOpts?: RenderOptions;
// }) => {
// 	return defineTestUi<TRenderExtraProps, TTestIds, TGetUi>(
// 		opts
// 	).render() as ReturnType<TGetUi> & {
// 		testIds: TTestIds;
// 	} & RenderResult;
// };

// export const RenderCountComponent = ({
// 	useMethod,
// 	testId,
// }: {
// 	useMethod: () => any;
// 	testId: string;
// }) => {
// 	const renderCount = useRef(0);
// 	useMethod();
// 	renderCount.current++;
// 	return <div data-testid={testId}>{renderCount.current}</div>;
// };

//  eslint-disable no-unused-vars */
import { act, fireEvent, render, RenderResult } from '@testing-library/react';
import { ReactNode, useRef } from 'react';
import { describe, expect, test } from 'vitest';
import { state } from '../src/create-state';
type RenderOpts = Parameters<typeof render>[1];
export const createTestUi = <
	TTestIds extends Record<string, string>,
	TGetUi extends (
		renderResult: ReturnType<typeof render> & { testIds: TTestIds }
	) => object,
>(opts: {
	ui: TGetUi;
	testIds: TTestIds;
}) => {
	const { ui: getUi, testIds } = opts;
	const renderUi = (
		renderCallback: ReactNode | ((data: { testIds: TTestIds }) => ReactNode),
		renderOpts?: RenderOpts
	) => {
		const firstArg =
			typeof renderCallback === 'function'
				? renderCallback({ testIds })
				: renderCallback;

		const Comp =
			typeof renderCallback === 'function'
				? renderCallback
				: () => renderCallback;

		const Node = () => (
			<>
				<Comp testIds={testIds} />
			</>
		);
		const renderResults = render(<Node />, renderOpts);
		return {
			testIds,
			// render,
			...renderResults,
			...getUi({ ...renderResults, testIds }),
		} as ReturnType<typeof render> & ReturnType<TGetUi> & { testIds: TTestIds };
	};
	return {
		testIds,
		render: renderUi,
	};
};

export function createGetUi<
	TGetUiFn extends (renderResult: RenderResult) => object,
>(getUi: TGetUiFn) {
	return (ui: ReactNode, opts?: RenderOpts) => {
		const renderResults = render(ui, opts);
		return {
			...renderResults,
			...getUi(renderResults),
		} as ReturnType<TGetUiFn> & ReturnType<typeof render>;
	};
}

export const RenderCountComponent = ({
	useMethod,
	testId,
}: {
	useMethod: () => any;
	testId: string;
}) => {
	const renderCount = useRef(0);
	useMethod();
	renderCount.current++;
	return <div data-testid={testId}>{renderCount.current}</div>;
};
