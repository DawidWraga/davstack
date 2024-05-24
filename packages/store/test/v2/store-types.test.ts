import { describe, expectTypeOf, it } from 'vitest';
import { Simplify, State, state, StateValue, store, StoreApi } from '../../src';

describe('correct store types', () => {
	it('store should have StoreApi<TStateValue> type', () => {
		const myStore = store(0);
		expectTypeOf(myStore).toEqualTypeOf<StoreApi<number>>();
		//EXPECTED =  const myStore: StoreApi<number>
		//RECIEVED =  const myStore: StoreApi<number>
		// correctly inferred the type
	});
	it('state should have State<TStateValue> type', () => {
		const myState = state(0);
		expectTypeOf(myState).toEqualTypeOf<State<number>>();

		// EXPECTED = const myState: State<number>
		// RECIEVED = const myState: State<number>
		// correctly inferred the type
	});
});

// notes on how I fixed it:

// to fix it, I added & Simplify<{}> to the state type.
// adding just & {} didn't work
// maybe it's because there are two generics being resolved so the IDE just simplifies the type to the name of the type, instead of showing the entire type on hover.
// by making advantage of this mechanism, I think we can just add any type that doesn't change the type, like Simplify<{}> to make the type easier to read.

// for some reason, when passing the generic directly to the staet function, like this:
type StoreApi2Number = State<number>;
// the type is expanded to something like this:
/**
 const myState: {
    get: <TSelector extends (state: number) => unknown = (state: number) => number>(selector?: TSelector | undefined) => TSelector extends (state: number) => infer TReturnType ? TReturnType : number;
    set: (newValueOrFn: number | ((prev: number) => number)) => void;
    use: <TSelector extends (state: number) => unknown = (state: number) => number>(selector?: TSelector | undefined, equalityFn?: EqualityChecker<...> | undefined) => TSelector extends (state: number) => infer TReturnType ? TReturnType : number;
    onChange: (callback: (value: number, prevValue: number) => void, options?: OnChangeOptions<...> | undefined) => UnsubscribeFn;
 */

// however, if you cast the type as a return value of a function, like this:
function getStore<T extends StateValue>() {
	return null as unknown as State<T> 
}

// and then use the function to get the type, like this:
const myStore = getStore<number>();

// then you get the correct type:
/**
 const myStore: State<number>
 */

// this is a workaround to get the correct type. It's not ideal, but it gets the job done.

