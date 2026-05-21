import { store } from '@davstack/store';
import { Howl, HowlOptions } from 'howler';
import { useEffect } from 'react';
import { lazyImportHowlerConstructor } from './howler-lazy';
import { FlattenedObject, flattenObject } from './utils/flatten-object';
/**
 * warning: if changing play options the make sure to update the custom options section in Readme.md
 */

export interface PlayOptions {
	/**
	 * The playback rate of the sound (1 is normal speed, 2 is double speed, 0.5 is half speed)
	 * If not set, it will use the global playback rate.
	 */
	playbackRate?: number;
	/**
	 * The volume of the sound. If not set, it will use the global volume.
	 * If both global volume and options volume are set, it will multiply them.
	 */
	volume?: number;
	/**
	 * overrides the global soundEnabled setting
	 */
	forceSoundEnabled?: boolean;
	id?: string;
}

/**
 * Will set the default options for the sound store, but can override some of them (eg volume) inside the play function, or by using the set function on the store eg soundStore.volume.set(0.5)
 * 
 * @example
 ```tsx
// lib/sound-store.ts
const SOUND_BASE_PATH = './sounds';
const soundStore = createSoundStore({
	soundNameToPath: {
		pop: `${SOUND_BASE_PATH}/pop.mp3`,
		switchOn: `${SOUND_BASE_PATH}/switch-on.mp3`,
		switchOff: `${SOUND_BASE_PATH}/switch-off.mp3`,
	},
});

 */
export type CreateSoundStoreOptions<
	TSoundNameToPath extends Record<string, string | Record<string, string>>,
> = {
	/**
	 * A map of sound names to their file paths
	 */
	soundNameToPath: TSoundNameToPath;
	/**
	 * The global volume of the sound (0 to 1)
	 * @default 1
	 */
	volume?: number;
	/**
	 * The playback rate of the sound (1 is normal speed, 2 is double speed, 0.5 is half speed)
	 * @default 1
	 */
	playbackRate?: number;
	/**
	 * If interrupt is true, the sound will stop and play from the beginning if it is already playing
	 * @default false
	 */
	interrupt?: boolean;
	/**
	 * If soundEnabled is false, the sound will not play, unless forceSoundEnabled is true
	 * @default true
	 */
	soundEnabled?: boolean;
	// onload?: () => void;
	// sprite?: SpriteMap;
};

export function createSoundStore<
	TSoundNameToPath extends Record<string, string | Record<string, string>>,
>(options: CreateSoundStoreOptions<TSoundNameToPath>) {
	const {
		soundNameToPath,
		volume = 1,
		playbackRate = 1,
		interrupt = false,
		soundEnabled = true,
	} = options;

	// flatten object to allow for nested sound names
	type FlattenedSoundNameToPath = FlattenedObject<TSoundNameToPath, true>;
	type SoundName = keyof FlattenedSoundNameToPath;
	const flattenedSoundNameToPath = flattenObject(soundNameToPath, {
		overwrite: true,
	}) as FlattenedSoundNameToPath;

	const initialSounds = Object.fromEntries(
		Object.keys(flattenedSoundNameToPath).map(
			(key) => [key, undefined] as const
		)
	) as unknown as Record<SoundName, Howl>;

	// Create the sound store
	return store({
		sounds: initialSounds,
		volume,
		playbackRate,
		soundEnabled,
		interrupt,
	})
		.extend((store) => ({
			/**
			 * Loads a sound howler instance into the store
			 *
			 * @param soundName the name of the sound to initialize
			 * @param options options to pass to the Howler constructor
			 */
			async initializeSound(
				soundName: SoundName,
				options?: HowlOptions & {
					onload?: Function;
				}
			) {
				const HowlerConstuctor = await lazyImportHowlerConstructor();

				if (!HowlerConstuctor) throw new Error('HowlerConstructor not found');

				if (!(soundName in flattenedSoundNameToPath)) {
					throw new Error(
						`Sound ${soundName.toString()} not found in soundFiles`
					);
				}

				const sound = store.sounds.get()[soundName];

				if (!sound) {
					// const onload = options?.onload ?? store.onload.get();
					store.set((draft) => {
						const src = flattenedSoundNameToPath[soundName];
						const Howler = new HowlerConstuctor({
							// @ts-expect-error
							src: Array.isArray(src) ? src : [src],
							volume: store.volume.get(),
							rate: store.playbackRate.get(),
							...options,
						});

						draft.sounds[soundName] = Howler;
					});
				}
			},
		}))
		.extend((store) => ({
			/**
			 * function to initialize all sounds in the store
			 */
			initAllSounds() {
				Object.keys(flattenedSoundNameToPath).forEach((soundName) => {
					store.initializeSound(soundName as SoundName);
				});
			},
		}))
		.extend((store) => ({
			/**
			 * Component that initializes all sounds on mount
			 * Place this component in the root layout of your app to ensure all sounds are loaded
			 *
			 */
			InitAllSounds() {
				/**
				 * We need to initialize all sounds on user interaction
				 * If we try to initialize sounds on page load, the browser will block the audio
				 */
				useEffect(() => {
					let initialized = false;

					// Function to initialize all sounds
					function initAllSounds() {
						if (initialized) return;
						store.initAllSounds();
						initialized = true;
						cleanUp();
					}

					// removes the event listeners (after sounds are initialized and/or unmount)
					function cleanUp() {
						document.removeEventListener('touchstart', initAllSounds, true);
						document.removeEventListener('click', initAllSounds, true);
					}

					// Attach event listeners to unlock audio on user interaction
					document.addEventListener('touchstart', initAllSounds, true);
					document.addEventListener('click', initAllSounds, true);

					// Clean up event listeners on component unmount
					return () => {
						cleanUp();
					};
				}, []);

				return null;
			},
		}))
		.extend((store) => ({
			/**
			 * Play a sound
			 * @param soundName the name of the sound to play
			 * @param playOptions options to pass to the play function
			 */
			async playSound(soundName: SoundName, options: PlayOptions = {}) {
				const sound = store.sounds.get()[soundName];
				if (!sound) {
					await store.initializeSound(soundName);
				}

				if (!sound) return;

				if (!store.soundEnabled.get() && !options.forceSoundEnabled) {
					return;
				}

				if (store.interrupt.get()) sound.stop();

				sound.rate?.(options.playbackRate ?? store.playbackRate.get());
				sound.volume?.(
					// if global volume and options volume are set, multiply them
					options.volume
						? options.volume * store.volume.get()
						: store.volume.get()
				);
				// if (options.playbackRate) {
				// }

				sound?.play(options.id);
			},
			/**
			 * Stop a sound
			 * @param soundName the name of the sound to stop
			 */
			stopSound(soundName: SoundName) {
				const sound = store.sounds.get()[soundName];
				if (sound) {
					sound.stop();
				}
			},
			/**
			 * Pause a sound
			 * @param soundName the name of the sound to pause
			 */
			pauseSound(soundName: SoundName) {
				const sound = store.sounds.get()[soundName];
				if (sound) {
					sound.pause();
				}
			},
		}));
}
