import { createStore } from '@davstack/store';
import { Howl, HowlOptions } from 'howler';
import { useEffect } from 'react';

// Define the sound files
const SOUND_BASE_PATH = './sounds';
const soundNameToPathMap = {
	pop: `${SOUND_BASE_PATH}/pop.mp3`,
	switchOn: `${SOUND_BASE_PATH}/switch-on.mp3`,
	switchOff: `${SOUND_BASE_PATH}/switch-off.mp3`,
};

// same keys but values should be undefined
const soundStoreInitial = Object.fromEntries(
	Object.keys(soundNameToPathMap).map((key) => [key, undefined] as const)
) as unknown as Record<SoundName, Howl>;

export type SoundName = keyof typeof soundNameToPathMap;

export type PlayOptions = {
	spriteOrId?: string | number | undefined;
};

export type HowlConstructorType = new (options: HowlOptions) => Howl;

let HowlConstructor = null as HowlConstructorType | null;

// Create the sound store
export const soundStore = createStore({ sounds: soundStoreInitial })
	.extend((store) => ({
		async getHowlerConstructor() {
			const currentHowler = HowlConstructor;
			if (currentHowler) return currentHowler;

			const module = await import('howler');
			const newHowler = module.Howl ?? module.default.Howl;

			HowlConstructor = newHowler;
			return newHowler;
		},
	}))
	.extend((store) => ({
		async initializeSound(soundName: SoundName, options?: HowlOptions) {
			const HowlerConstuctor = await store.getHowlerConstructor();

			if (!HowlerConstuctor) throw new Error('HowlerConstructor not found');

			if (!(soundName in soundNameToPathMap)) {
				throw new Error(`Sound ${soundName} not found in soundFiles`);
			}

			const sound = store.sounds.get()[soundName];

			if (!sound) {
				store.set((draft) => {
					draft.sounds[soundName] = new HowlerConstuctor({
						src: [soundNameToPathMap[soundName]],
						...options,
					});
				});
			}
		},
	}))
	.extend((store) => ({
		initAllSounds() {
			Object.keys(soundNameToPathMap).forEach((soundName) => {
				store.initializeSound(soundName as SoundName);
			});
		},
	}))
	.extend((store) => ({
		InitAllSounds() {
			useEffect(() => {
				store.initAllSounds();
			}, []);
			return null;
		},
	}))
	.extend((store) => ({
		async playSound(soundName: SoundName, playOptions?: PlayOptions) {
			const sound = store.sounds.get()[soundName];
			if (!sound) {
				await store.initializeSound(soundName);
			}

			sound.play(playOptions?.spriteOrId);
		},
		stopSound(soundName: SoundName) {
			const sound = store.sounds.get()[soundName];
			if (sound) {
				sound.stop();
			}
		},
		pauseSound(soundName: SoundName) {
			const sound = store.sounds.get()[soundName];
			if (sound) {
				sound.pause();
			}
		},
	}));
