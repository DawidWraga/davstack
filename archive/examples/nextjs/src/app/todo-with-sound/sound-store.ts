import { createSoundStore } from '@davstack/sound';
const SOUND_BASE_PATH = './sounds';
const soundNameToPathMap = {
	pop: `${SOUND_BASE_PATH}/pop.mp3`,
	switchOn: `${SOUND_BASE_PATH}/switch-on.mp3`,
	switchOff: `${SOUND_BASE_PATH}/switch-off.mp3`,
	bite: `${SOUND_BASE_PATH}/bite.mp3`,
	pfff: `${SOUND_BASE_PATH}/pfff.mp3`,
};

export const soundStore = createSoundStore({
	soundNameToPath: soundNameToPathMap,
});
