import { createStore } from '@davstack/store';
import { Howl, HowlOptions } from 'howler';
import { useEffect } from 'react';
import { HowlPlayOptions, lazyImportHowlerConstructor } from './howler-lazy';

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

export interface PlayOptions extends HowlPlayOptions {}

// Create the sound store
export const soundStore = createStore({ sounds: soundStoreInitial })
	.extend((store) => ({
		async initializeSound(soundName: SoundName, options?: HowlOptions) {
			const HowlerConstuctor = await lazyImportHowlerConstructor();

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
		/**
		 * function to initialize all sounds in the store
		 */
		initAllSounds() {
			Object.keys(soundNameToPathMap).forEach((soundName) => {
				store.initializeSound(soundName as SoundName);
			});
		},
	}))
	.extend((store) => ({
		/**
		 * Component that initializes all sounds on mount
		 * Place this component in the root layout of your app to ensure all sounds are loaded
		 */
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
