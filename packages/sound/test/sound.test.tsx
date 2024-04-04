import { describe, it, expect, vi, expectTypeOf } from 'vitest';
import { soundStore, SoundName, HowlConstructorType } from '../src/sound';
import { HowlerMock, HowlMock } from './howler.mock';
vi.mock('howler', () => ({
	Howl: HowlMock,
	Howler: HowlerMock,
}));

describe('soundStore', () => {
	it('should initialize Howler constructor', async () => {
		const Howler = await soundStore.getHowlerConstructor();
		expect(Howler).toBeDefined();

		expectTypeOf(Howler).toEqualTypeOf<HowlConstructorType>();
	});

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
