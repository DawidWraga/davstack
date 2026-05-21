## Why sound?

Game devs have know this for years - our reward systems love the **satisfying feeling** of hearing ticks and clicks when we engage with the environment, and celebrations when we make progress.

Even though effect of sounds is often subconscious, the impact of high quality _micro-interactions_ should not be underestimated.

However, with a million other things to do, it can be hard to find the _time and effort_ to implement sounds effects and sound settings into your web apps.

For this reason, I made a small but mighty react makes the process of adding sounds to your React/Next.js a **joy to work with** - both in terms of developer experience (DX) and user experience (UX).

## Usage demo

After a quick 2-minute setup, you will have access to a wide range of high quality sound effects that you can call anywhere in your app with 1 line of code!

```tsx
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

## Quick Start Guide

### Step 0: What is Davstack sound?

Davstack Sound is super fast and simple typescript sound management library for React/Next.js apps.

It is built on top of Howler.js, a battle-tested audio library that supports all major browsers.

It also makes global sound settings a breeze, allowing users to change volume, mute, or stop all sounds.

### Step 1: Installing Davstack Sound

To get started, install Davstack Sound in your project by running the following command:

```bash
npm install @davstack/sound
```

### Step 2: Adding Sound Assets

Davstack sound is completely sound-agnostic - feel free to use whatever sounds right to you and your users.

Simply place all your sound assets into your `/public` folder (assuming Next.js usage, adjust otherwise)

I recommend using the Material Design Sound Assets. These assets provide a wide range of well-crafted sounds that are well suited for application interactions.

#### If you want to use the Material Design Sound Assets, follow these steps:

1. Download the Material Design Sound Assets from the official website: [Material Design Sound Resources](https://m2.material.io/design/sound/sound-resources.html)

2. Extract the downloaded ZIP file and locate the 4 main sound folders. (`.ogg` file format is recommended for a balance between quality and file size)

3. Rename the folders to: alert, navigation, hero, secondary.

4. Copy the renamed folders into the `/public/sounds/material` .

### Step 3: Defining Your Sound Store

With the sound assets in place, it's time to define your sound store. Create a new file called `sound-store.ts` in your project's `lib` directory (or any other appropriate location).

#### Sound Store definition example:

```ts
// lib/sound-store.ts
import { createSoundStore } from '@davstack/sound';

// path relative to /public (assuming you are using next.js) eg `./public/sounds/switch-on.mp3`
const SOUND_BASE_PATH = './sounds';
export const soundStore = createSoundStore({
	soundNameToPath: {
		switchOn: `${SOUND_BASE_PATH}/switch-on.mp3`,
		switchOff: `${SOUND_BASE_PATH}/switch-off.mp3`,
	},
});
```

#### To import all material sounds, copy the following example:

```tsx
// lib/sound-store.ts
import { createSoundStore } from '@davstack/sound';

const MATERIAL_SOUND_BASE_PATH = '/sounds/material'; // points to /public/sounds/material

const materialSoundNamesToPaths = {
	// can also add any other custom sounds here
	alert: {
		highIntensity: `${MATERIAL_SOUND_BASE_PATH}/alert/alert_high-intensity.ogg`,
		simple: `${MATERIAL_SOUND_BASE_PATH}/alert/alert_simple.ogg`,
		gentleAlarm: `${MATERIAL_SOUND_BASE_PATH}/alert/alarm_gentle.ogg`,
		ringtoneMinimal: `${MATERIAL_SOUND_BASE_PATH}/alert/ringtone_minimal.ogg`,

		error1: `${MATERIAL_SOUND_BASE_PATH}/secondary/alert_error-01.ogg`,
		error2: `${MATERIAL_SOUND_BASE_PATH}/secondary/alert_error-02.ogg`,
		error3: `${MATERIAL_SOUND_BASE_PATH}/secondary/alert_error-03.ogg`,
	},
	notification: {
		decorative1: `${MATERIAL_SOUND_BASE_PATH}/alert/notification_decorative-01.ogg`,
		decorative2: `${MATERIAL_SOUND_BASE_PATH}/alert/notification_decorative-02.ogg`,
		highIntensity: `${MATERIAL_SOUND_BASE_PATH}/alert/notification_high-intensity.ogg`,
		simple1: `${MATERIAL_SOUND_BASE_PATH}/alert/notification_simple-01.ogg`,
		simple2: `${MATERIAL_SOUND_BASE_PATH}/alert/notification_simple-02.ogg`,
	},
	navigation: {
		backwardSelection: `${MATERIAL_SOUND_BASE_PATH}/primary/navigation_backward-selection.ogg`,
		forwardSelection: `${MATERIAL_SOUND_BASE_PATH}/primary/navigation_forward-selection.ogg`,
		hoverTap: `${MATERIAL_SOUND_BASE_PATH}/primary/navigation_hover-tap.ogg`,
		backwardSelectionMinimal: `${MATERIAL_SOUND_BASE_PATH}/primary/navigation_backward-selection-minimal.ogg`,
		forwardSelectionMinimal: `${MATERIAL_SOUND_BASE_PATH}/primary/navigation_forward-selection-minimal.ogg`,
		selectionCompleteCelebration: `${MATERIAL_SOUND_BASE_PATH}/primary/navigation_selection-complete-celebration.ogg`,
		transitionLeft: `${MATERIAL_SOUND_BASE_PATH}/secondary/navigation_transition-left.ogg`,
		transitionRight: `${MATERIAL_SOUND_BASE_PATH}/secondary/navigation_transition-right.ogg`,
		unavailableSelection: `${MATERIAL_SOUND_BASE_PATH}/secondary/navigation_unavailable-selection.ogg`,
		cancel: `${MATERIAL_SOUND_BASE_PATH}/secondary/navigation-cancel.ogg`,
	},
	stateChange: {
		confirmDown: `${MATERIAL_SOUND_BASE_PATH}/primary/state-change_confirm-down.ogg`,
		confirmUp: `${MATERIAL_SOUND_BASE_PATH}/primary/state-change_confirm-up.ogg`,
	},
	hero: {
		decorativeCelebration1: `${MATERIAL_SOUND_BASE_PATH}/hero/hero_decorative-celebration-01.ogg`,
		decorativeCelebration2: `${MATERIAL_SOUND_BASE_PATH}/hero/hero_decorative-celebration-02.ogg`,
		decorativeCelebration3: `${MATERIAL_SOUND_BASE_PATH}/hero/hero_decorative-celebration-03.ogg`,
		simpleCelebration1: `${MATERIAL_SOUND_BASE_PATH}/hero/hero_simple-celebration-01.ogg`,
		simpleCelebration2: `${MATERIAL_SOUND_BASE_PATH}/hero/hero_simple-celebration-02.ogg`,
		simpleCelebration3: `${MATERIAL_SOUND_BASE_PATH}/hero/hero_simple-celebration-03.ogg`,
	},
	ui: {
		cameraShutter: `${MATERIAL_SOUND_BASE_PATH}/primary/ui_camera-shutter.ogg`,
		lock: `${MATERIAL_SOUND_BASE_PATH}/primary/ui_lock.ogg`,
		unlock: `${MATERIAL_SOUND_BASE_PATH}/primary/ui_unlock.ogg`,

		tapVariant1: `${MATERIAL_SOUND_BASE_PATH}/primary/ui_tap-variant-01.ogg`,
		tapVariant2: `${MATERIAL_SOUND_BASE_PATH}/primary/ui_tap-variant-02.ogg`,
		tapVariant3: `${MATERIAL_SOUND_BASE_PATH}/primary/ui_tap-variant-03.ogg`,
		tapVariant4: `${MATERIAL_SOUND_BASE_PATH}/primary/ui_tap-variant-04.ogg`,
		loading: `${MATERIAL_SOUND_BASE_PATH}/secondary/ui_loading.ogg`,
		refreshFeed: `${MATERIAL_SOUND_BASE_PATH}/secondary/ui_refresh-feed.ogg`,
	},
} as const;

export const soundStore = createSoundStore({
	soundNameToPath: materialSoundNamesToPaths,
});
```

Note: you may want to comment out the sounds you are not using to avoid unnecessary loading of sound assets.

### Step 4: Playing Sounds

With the sound store set up, playing sounds in your app is a breeze. Simply import the `soundStore` and call the `playSound` method with the desired sound name.

```tsx
import { soundStore } from 'lib/sound-store';

soundStore.playSound('hero.decorativeCelebration1');
```

In this example, we import the `soundStore` and play the "hero.decorativeCelebration1" sound using the flattened object notation.

### Step 5: Initializing Sounds (Optional)

To ensure that sounds play instantly without any delay, you can initialize the sounds when your app loads. This step is optional but recommended for the best user experience.

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

Place the `soundStore.InitAllSounds` component in your app's root layout component. This will preload and cache all the sounds, ensuring instant playback when needed.

### Step 6: Customizing Sound Settings

#### Adjusting global/individual sound settings

Davstack makes it easy to define global sound settings, such as adjusting volume or enabling/disabling sounds.

```tsx
// Adjusting settings when playing a sound
soundStore.playSound('pop', {
	volume: 0.5,
	playbackRate: 2,
});

// Adjusting global settings
soundStore.volume.set(0.8);
soundStore.soundEnabled.set(false);
```

#### Giving users control over global volume

It is best practice to provide users with control over sound settings in your app.

To give users control over the global volume, you can create a volume control component that interacts with the `soundStore`.

```tsx
// components/volume-control.tsx
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
```

In this example, we create a range input that represents the volume control. It retrieves the current volume value from the `soundStore` using the `use` method and updates the volume when the input value changes.

We also play a 'pop' sound when the user releases the mouse or ends a touch interaction to provide auditory feedback.

Note: if the global sound is set to 0.5 and you pass in a volume of 0.5 to the playSound function, the sound will play at 0.25 volume (0.5 \* 0.5)

#### Allowing users to enable/disable sounds globally

To allow users to enable or disable sounds globally, you can create a sound toggle component that interacts with the `soundStore`.

```tsx
// components/sound-toggle.tsx
import { soundStore } from '@/lib/sound-store';

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
				? 'Sound On (press to turn off)'
				: 'Sound Off (press to turn on)'}
		</button>
	);
};
```

In this example, we create a button that toggles the sound on or off. It retrieves the current `soundEnabled` value from the `soundStore` using the `use` method and updates the value when the button is clicked. We also play different sounds ('switchOff' and 'switchOn') depending on the state change to provide auditory feedback.

## Conclusion:

While adding sounds to your web app may seem like a subtle change, it can make for a surprisingly satisfying user experience.

With Davstack Sound, the process of integrating sounds into your React/Next.js app becomes a delightful and effortless experience.

If you found this guide / package helpful then check out the other [Davstack](https://davstack.com/) packages for more tools to enhance your web development workflow.

Have a great day, and happy coding! 📈

PS Please share a link to any other audio-asset resources or your website on the comments, I'd love to see your creations!
