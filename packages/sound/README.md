# Davstack Sound

Davstack sound is the simplest way to add sound FX to your React/next.js app. It's built on top of Howler.js, a popular audio library that supports all major browsers.

Visit the [DavStack Sound Docs](https://davstack.com/sound/overview) for more information and examples.

## Features

- **Super Simple API**: Just call `soundStore.play('soundName')` to play a sound. No hooks required.
- **Excellent DX**: Define all your sounds in once place and play them with full type safety.
- **Optimized Performance**: All sounds are cached and preloaded, so they play instantly. Howler.js is lazy-loaded to keep bundle size down.
- **Easily change global sound settings**: Change volume, mute, or stop all sounds with a single line of code.

## Demo Usage

```tsx
// lib/sound-store.ts
import { createSoundStore } from '@davstack/sound';

// path relative to /public (assuming you are using next.js)
const SOUND_BASE_PATH = './sounds';
export const soundStore = createSoundStore({
	soundNameToPath: {
		switchOn: `${SOUND_BASE_PATH}/switch-on.mp3`,
		switchOff: `${SOUND_BASE_PATH}/switch-off.mp3`,
		// ...
	},
});

// components/button.tsx
import { soundStore } from '@/lib/sound-store';

export const Button = () => {
	return (
		<button
			onClick={() => {
				soundStore.playSound('switchOn');
			}}
		>
			Click me
		</button>
	);
};
```

### Installation

```bash
npm install @davstack/sound
```

Note: This package is built with [Davstack Store](https://davstack.com/store/overview) and therefore [Zustand](https://github.com/pmndrs/zustand) is a peer dependency, so you will need to install it separately if you haven't already.

## Usage Guide

### Add sound assets into your project

First, Add sounds to /public eg `./public/sounds/pop.mp3` (assuming you are using next.js)

To find a small selection of high quality sounds, check out this link (github repo)

credit to josh w comeau for the sounds and the idea (i took the sounds from his network requets)

alternatively the material ui sounds library is pretty good too

### Define your sound store

```tsx
// lib/sound-store.ts

// path relative to /public (assuming you are using next.js)
const SOUND_BASE_PATH = './sounds';
const soundStore = createSoundStore({
	soundNameToPath: {
		pop: `${SOUND_BASE_PATH}/pop.mp3`,
		switchOn: `${SOUND_BASE_PATH}/switch-on.mp3`,
		switchOff: `${SOUND_BASE_PATH}/switch-off.mp3`,
		// ...
	},
});
```

### Initialize sounds in app (optional)

The first sound you play may have some delay. This is because the audio assets need some time to load.
Additionally, Howler (the library we're using) is lazily loaded to keep bundle size down / prevent impacting initial page load time. However, this further delays the first sound.

To mitigate this, place the `soundStore.InitAllSounds` component in your app eg in root layout component

```tsx
// app/layout.tsx
import { soundStore } from '@/lib/sound-store';

export const Layout = ({ children }) => {
	return (
		<>
			{children}
			<soundStore.InitAllSounds />
		</>
	);
};
```

Note: The browser does not allow audio context to be loaded until a user gesture is detected. To get around this, the `InitAllSounds` component will wait for the first user interaction before initializing the audio context.

### Play sounds

```tsx
// components/button.tsx
import { soundStore } from '@/lib/sound-store';

export const Button = () => {
	return (
		<button
			onClick={() => {
				soundStore.playSound('pop');
			}}
		>
			Click me
		</button>
	);
};
```

### Play sounds with custom options

<!--  warning: if making any changes to the type descriptions here ensure to keep the actual type doc stirngs updated too -->

```ts
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

// example usage
soundStore.playSound('pop', {
	volume: 0.5,
	playbackRate: 2,
});
```

### Change global sound settings

```tsx
// components/sound-controls.tsx
import { soundStore } from '@/lib/sound-store';

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
				// warning: make sure you actually have "pop" sound configured in your sound store
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


Note: if the global sound is set to 0.5 and you pass in a volume of 0.5 to the playSound function, the sound will play at 0.25 volume (0.5 * 0.5)
```

### Acknowledgements

Davstack Sound has been heavily inspired by [use-sound](https://www.npmjs.com/package/use-sound), another great library for adding sound to your react app. A big shout-out to [Josh w Comeau](https://www.joshwcomeau.com/react/announcing-use-sound-react-hook) for his amazing work.

### Contributing

Contributions are welcome! Please read our [contributing guide](link-to-contributing-guide) for details on our code of conduct and the submission process.

### License

This project is licensed under the [MIT License](link-to-license). See the LICENSE file for details.
