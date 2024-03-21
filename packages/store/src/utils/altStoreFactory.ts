/* eslint-disable prettier/prettier */
import React from 'react';

import { AltStoreApi } from '../alt-types';
import { State } from '../types';

export const altStoreFactory = <
  TName extends string,
  T extends State,
  TComputed extends Record<string, any>,
>(
  api: AltStoreApi<TName, T, TComputed>
) => {
  return {
    ...api,
    withComputed: <TNewComputed>(
      builder: (store: AltStoreApi<TName, T>) => TNewComputed
    ): AltStoreApi<TName, T, TComputed & TNewComputed> =>
      // @ts-expect-error
      altStoreFactory({
        ...api,
        ...builder(api),
      }),
    // withLocalProvider(){
    //   return {
    //     ...api,
    //     useLocal: () => {
    //       const [state, setState] = React.useState(api.get());
    //       React.useEffect(() => {
    //         const unsubscribe = api.subscribe((newState) => {
    //           setState(newState);
    //         });
    //         return unsubscribe;
    //       }, []);
    //       return state;
    //     },
    //   };
    // }
  };
};
