import { createStore } from '@davstack/store';
import { Howl, HowlOptions } from 'howler';
import { useEffect } from 'react';
import { lazyImportHowlerConstructor } from './howler-lazy';

export interface PlayOptions {
	id?: string;
	forceSoundEnabled?: boolean;
	playbackRate?: number;
	volume?: number;
}

export type CreateSoundStoreOptions<
	TSoundNameToPath extends Record<string, string>,
> = {
	soundNameToPath: TSoundNameToPath;
	volume?: number;
	playbackRate?: number;
	interrupt?: boolean;
	soundEnabled?: boolean;
	// onload?: () => void;
	// sprite?: SpriteMap;
};

export function createSoundStore<
	TSoundNameToPath extends Record<string, string>,
>(options: CreateSoundStoreOptions<TSoundNameToPath>) {
	const {
		soundNameToPath,
		volume = 1,
		playbackRate = 1,
		interrupt = false,
		soundEnabled = true,
	} = options;

	type SoundName = keyof TSoundNameToPath;

	const initialSounds = Object.fromEntries(
		Object.keys(soundNameToPath).map((key) => [key, undefined] as const)
	) as unknown as Record<SoundName, Howl>;
	// Create the sound store
	return createStore({
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

				if (!(soundName in soundNameToPath)) {
					throw new Error(
						`Sound ${soundName.toString()} not found in soundFiles`
					);
				}

				const sound = store.sounds.get()[soundName];

				if (!sound) {
					// const onload = options?.onload ?? store.onload.get();
					store.set((draft) => {
						const src = soundNameToPath[soundName];
						const Howler = new HowlerConstuctor({
							src: Array.isArray(src) ? src : [src],
							volume: store.volume.get(),
							rate: store.playbackRate.get(),
							...options,
						});
						// @ts-expect-error
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
				Object.keys(soundNameToPath).forEach((soundName) => {
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

				sound?.play(options?.id);

				if (
					!sound ||
					(!store.soundEnabled.get() && !options.forceSoundEnabled)
				) {
					return;
				}

				if (store.interrupt.get()) sound.stop();

				sound.rate?.(options.playbackRate ?? store.playbackRate.get());
				sound.volume?.(options.volume ?? store.volume.get());
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
