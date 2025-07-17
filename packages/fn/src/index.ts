export * from './create-fn';
export * from './init-create-fn';
export * from './errors';
export * from './pipe';
export * from './utils/type-utils';
export * from './utils/zod-sensitive';
export * from './utils/init-procedure-factory';
export const helloWorld = () => {
	console.log('Hello, world!');
	return 'Hello, world!';
};
