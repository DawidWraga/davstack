## adding .create() and removing automatic instance creation

- change .\_.createInstance to .create()
  - change createInstance(intialState) to create({initialState, input (optinal)})

Naming pattern:

```ts

const soundStoreBuilder = storeBuilder()
  .state({...})
  .actions({...})


export const soundStore = soundStoreBuilder.create({initialState, input})

```

### Why?

- this is so that we dont create eagerly, optimizng for multiple instance / local state
- additionally, ** WE CAN USE FULLY TYPED PERSISTANCE **
  - currenlty .middlware needs to be called before state and cannot be extended after
  - this is because as soon as we call state() we create the instance and therefore it's too late to change the middleware
  - hoewver, if we create the instance AFTEr the definion using create() then we can define middlware later on

### Example

```ts

const soundStoreBuilder = storeBuilder()
  .state({...})
  .actions({...})
  .persist(()=>{
    // persist logic

  })

```

### Persist logic

- need to return get/set/remove functions in accordance with zustand persist api
- need to be able to define separate persist logic for specific keys eg soundStore want to persist only user config and not the rest of the sound store

```ts

const soundStoreBuilder = storeBuilder()
  .state({...})
  .actions({...})
  .persist((store)=>({
    volume: {
      get(){
        return localStorage.getItem('volume')
      },
      set(value){
        localStorage.setItem('volume', value)
      },
      remove(){
        localStorage.removeItem('volume')
      }
    }
  }))

```

- need to have shorthand for for localStorage that just works with one word eg "localStorage"

## changes to quick usage (without .create())

```ts
const counterStore = store({});
// calls create internally, maybe dont allow extensions / actions?
```

## .input

input is passed to the store when creating, but is not a stateful so it doesn't generate the methods etc

- add input
  - storeBuilder().input(inputShape / schema)
  - i guess could either pass the input type generic or zod schema depending on the use case
  - the input could either be
    - assigned to the object directly eg Object.assign(store, {input}), usage = store.myInput
    - or spread onto the object eg Object.assign(store, input), usage = store.input.myInput

## .output

-define subset of methods to be exposed after calling .create()
-this is to hide internal methods and only expose the ones we want

```ts

const soundStoreBuilder = storeBuilder()
  .state({...})
  .actions({...})
  .output(store=>({
    playSound: store.playSound
  }))



```
