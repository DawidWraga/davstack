import { describe, expect, it, vi } from 'vitest';
import { createSoundStore } from '../src/sound';
import { HowlerMock, HowlMock } from './howler.mock';

// mock the howler module
vi.mock('howler', () => ({
	Howl: HowlMock,
	Howler: HowlerMock,
}));

// Define the sound files
const SOUND_BASE_PATH = './sounds';
const soundNameToPathMap = {
	pop: `${SOUND_BASE_PATH}/pop.mp3`,
	switchOn: `${SOUND_BASE_PATH}/switch-on.mp3`,
	switchOff: `${SOUND_BASE_PATH}/switch-off.mp3`,
};

const soundStore = createSoundStore({
	soundNameToPath: soundNameToPathMap,
});
export type SoundName = keyof typeof soundNameToPathMap;


describe('soundStore', () => {
	it('should initialize sound', async () => {
		const soundName: SoundName = 'pop';
		const soundBeforeInit = soundStore.sounds.get()[soundName];
		expect(soundBeforeInit).toBeUndefined();
		await soundStore.initializeSound(soundName);
		const sound = soundStore.sounds.get()[soundName];
		const myStore = soundStore.get();
		expect(sound).toBeDefined();
		expect(sound).toEqual(myStore.sounds[soundName]);
	});

	it('should play sound', async () => {
		const soundName: SoundName = 'pop';
		const playSpy = vi.spyOn(soundStore.sounds.get()[soundName], 'play');
		await soundStore.initializeSound(soundName);
		soundStore.playSound(soundName);
		expect(playSpy).toHaveBeenCalled();
	});

	it('should stop sound', async () => {
		const soundName: SoundName = 'pop';
		const stopSpy = vi.spyOn(soundStore.sounds.get()[soundName], 'stop');
		await soundStore.initializeSound(soundName);
		soundStore.stopSound(soundName);
		expect(stopSpy).toHaveBeenCalled();
	});

	it('should pause sound', async () => {
		const soundName: SoundName = 'pop';
		const pauseSpy = vi.spyOn(soundStore.sounds.get()[soundName], 'pause');
		await soundStore.initializeSound(soundName);
		soundStore.pauseSound(soundName);
		expect(pauseSpy).toHaveBeenCalled();
	});

	it('should throw error for invalid sound name', async () => {
		const invalidSoundName = 'invalid';
		await expect(
			soundStore.initializeSound(invalidSoundName as SoundName)
		).rejects.toThrowError(`Sound ${invalidSoundName} not found in soundFiles`);
	});
});
