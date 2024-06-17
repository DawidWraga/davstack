'use client';

import { createAudioRecorder } from './create-audio-recorder';

const audioRecorder = createAudioRecorder();
export const Microphone = () => {
	// const transcription = audioRecorder.$transcription.use();
	const isRecording = audioRecorder.$isRecording.use();

	const audioBlobs = audioRecorder.$audioBlobs.use();

	console.log('audioBlobs', audioBlobs);

	return (
		<div className="flex flex-col items-center justify-center stroke-gray-500 text-gray-300 ">
			<button
				type="button"
				onClick={() => {
					isRecording
						? audioRecorder.stopRecording()
						: audioRecorder.startRecording();
				}}
				className={
					'w-10 bg-gray-300 fill-stone-300 border-none bg-transparent' +
					isRecording
						? 'text-red-500'
						: 'text-gray-500'
				}
			>
				{isRecording ? 'Stop' : 'Start'}
			</button>
			{/* <Timer /> */}
			{audioBlobs &&
				audioBlobs.map((blob, i) => (
					<audio key={i} controls src={URL.createObjectURL(blob)} />
				))}
			{/* <p>{transcription}</p> */}
		</div>
	);
};

// function Timer() {
// 	const time = audioRecorder.timer.$intervalsPassed.use();
// 	return <h3>{time} seconds</h3>;
// }

export default function Page() {
	return (
		<div className="bg-slate-800 grid place-content-center w-screen  h-screen">
			<Microphone />
		</div>
	);
}
