import { DevtoolsOptions } from 'zustand/middleware';

import { State } from '../types';

export interface CreateStoreOptions<T extends State, TName> {
	name?: TName;

	/**
	 * Zustand middlewares.
	 */
	middlewares?: any[];

	/**
	 * Devtools middleware options.
	 */
	devtools?: DevtoolsOptions;

	/**
	 * Immer middleware options.
	 */
	immer?: ImmerOptions;

	/**
	 * Persist middleware options.
	 */
	persist?: PersistOptions<T>;
}

export interface ImmerOptions {
	/**
	 * Enable autofreeze.
	 */
	enabledAutoFreeze?: boolean;
	enableMapSet?: boolean;
}

import { PersistOptions as ZustandPersistOptions } from 'zustand/middleware';

export type StateStorage = {
	getItem: (name: string) => string | null | Promise<string | null>;
	setItem: (name: string, value: string) => void | Promise<void>;
};
export type StorageValue<S> = { state: S; version: number };

type PersistOptionsWithoutName<S> = Omit<ZustandPersistOptions<S>, 'name'>;

export type PersistOptions<S> = PersistOptionsWithoutName<S> & {
	enabled?: boolean;
	name?: string;
};
