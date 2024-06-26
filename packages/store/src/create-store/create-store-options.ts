import { DevtoolsOptions } from 'zustand/middleware';

import { StateValue } from '../types';

export interface StoreOptions<T extends StateValue> {
	name?: string;

	/**
	 * Zustand middlewares.
	 */
	middlewares?: any[];

	/**
	 * Devtools middleware options.
	 */
	devtools?: DevtoolsOptions;

	/**
	 * Persist middleware options.
	 */
	persist?: PersistOptions<T>;

	/**
	 * If mode is "CREATE" then the store will defined and created in the same step.
	 *
	 * If mode is "DEFINE" then the store will only be defined, and you will need to call the create method to create the store.
	 */
	// mode?: 'CREATE' | 'DEFINE';
}

import { PersistOptions as ZustandPersistOptions } from 'zustand/middleware';

export type StorageValue<S> = { state: S; version: number };

type PersistOptionsWithoutName<S> = Omit<ZustandPersistOptions<S>, 'name'>;

export type PersistOptions<S> = PersistOptionsWithoutName<S> & {
	enabled?: boolean;
	name?: string;
};
