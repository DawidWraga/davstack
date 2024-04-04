import { Howl, HowlOptions } from 'howler';
export type HowlPlayOptions = {
	spriteOrId?: string | number | undefined;
};

export type HowlConstructorType = new (options: HowlOptions) => Howl;

let HowlConstructor = null as HowlConstructorType | null;



/**
 * 
 * @returns 
 */
export async function lazyImportHowlerConstructor() {
	const currentHowler = HowlConstructor;
	if (currentHowler) return currentHowler;

	const module = await import('howler');
	const newHowlConstructor = module.Howl ?? module.default.Howl;

	HowlConstructor = newHowlConstructor;
	return newHowlConstructor;
}
