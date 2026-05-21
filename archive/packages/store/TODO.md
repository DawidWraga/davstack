[x]: add alt computed
[x]: fix computed types from store

CHANGED:
[-]: fix set callback should always return void, by moving over the immer produce logic away from the immer middleware and into the createMethod function

NEW:
[X]: adjust set callback to use immer ONLY if the state is draftable (ie object/array) otherwise must return value. The types now reflect this.
(unable to use produce on eg number)

new set callback:

- if the value is draftable ie a number / object then it will use immer by default so you should return void and mutate the object directly
- if the value is not draftable eg number or string then it will pass the prev value to the function and you must return a new value

removed type for .assign for non object state (still defaults to same behaviour as set )

[x]: add use selector support (both use and get)

[x]: context provider rename "initialValue" to sometihng liek initialState

[x]: merge the two createStoreContext functions

- inside store builder create just call all the ?
- the createEffectMethods unsub logic is only applicable for
  [x]: input / ouput can be replaced with just a function
