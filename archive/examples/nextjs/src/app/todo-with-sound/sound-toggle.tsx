import { soundStore } from './sound-store';

export const VolumeControl = () => {
	const volume = soundStore.volume.use();
	return (
		<input
			title="Volume control"
			type="range"
			min="0"
			max="1"
			step="0.01"
			value={volume}
			onMouseUp={() => {
				soundStore.playSound('pop');
			}}
			onTouchEnd={() => {
				soundStore.playSound('pop');
			}}
			onChange={(e) => {
				soundStore.volume.set(parseFloat(e.target.value));
			}}
		/>
	);
};

export const SoundToggle = () => {
	const soundEnabled = soundStore.soundEnabled.use();
	return (
		<button
			onClick={() => {
				if (soundEnabled) {
					soundStore.playSound('switchOff');
					soundStore.soundEnabled.set(false);
				} else {
					soundStore.soundEnabled.set(true);
					soundStore.playSound('switchOn');
				}
			}}
		>
			{soundEnabled
				? 'sound on (press to turn off)'
				: 'sound off (press to turn on)'}
		</button>
	);
};
