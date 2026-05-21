import { state, store } from '@davstack/store';
import { createTimer } from './create-timer';

// Define the MediaAudioTrackConstraints type
export type MediaAudioTrackConstraints = Pick<
	MediaTrackConstraints,
	| 'deviceId'
	| 'groupId'
	| 'autoGainControl'
	| 'channelCount'
	| 'echoCancellation'
	| 'noiseSuppression'
	| 'sampleRate'
	| 'sampleSize'
>;

// Define the options for creating the recorder
export interface CreateRecorderOptions {
	audioTrackConstraints?: MediaAudioTrackConstraints;
	onNotAllowedOrFound?: (exception: DOMException) => void;
	mediaRecorderOptions?: MediaRecorderOptions;
}

// Create the audio recorder function
export function createAudioRecorder(opts: CreateRecorderOptions = {}) {
	const $isPaused = state(false);
	const $isRecording = state(false);
	const $audioBlobs = store<Blob[]>([]);
	const $mediaRecorder = state<MediaRecorder | undefined>(undefined);

	// const timer = createTimer();
	// const $recordingTime = timer.$intervalsPassed;

	function addAudioBlob(blob: Blob) {
		$audioBlobs.set((draft) => {
			draft.push(blob);
		});
	}

	// Function to start recording
	const startRecording = async () => {
		// timer.reset();
		// timer.start();
		$isRecording.set(true);
		$isPaused.set(false);

		try {
			// Ensure that audio constraints are always requested
			const audioConstraints = opts.audioTrackConstraints || true;
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: audioConstraints,
			});

			const mediaRecorder = new MediaRecorder(
				stream,
				opts.mediaRecorderOptions
			);
			mediaRecorder.ondataavailable = (e) => {
				const blob = e.data;
				addAudioBlob(blob);
			};
			mediaRecorder.onstop = () => {
				stream.getTracks().forEach((track) => track.stop());
				// timer.stop();
				$isRecording.set(false);
			};

			mediaRecorder.start();

			// timer.start();
			$mediaRecorder.set(mediaRecorder);
		} catch (exception) {
			console.error('Error starting recording:', exception);
			$isRecording.set(false);
			opts.onNotAllowedOrFound?.(exception as DOMException);
		}
	};

	// Function to stop recording
	const stopRecording = async () => {
		const mediaRecorder = $mediaRecorder.get();
		mediaRecorder?.stop();
		// timer.stop();
		$isRecording.set(false);
		$isPaused.set(false);
	};

	// Function to toggle pause and resume
	const togglePause = () => {
		const mediaRecorder = $mediaRecorder.get();
		if (!mediaRecorder) return;

		if ($isPaused.get()) {
			mediaRecorder.resume();
			// timer.start();
			$isPaused.set(false);
		} else {
			mediaRecorder.pause();
			// timer.stop();
			$isPaused.set(true);
		}
	};

	// Return the control functions and state variables
	return {
		startRecording,
		stopRecording,
		togglePause,
		$audioBlobs,
		$isPaused,
		$isRecording,
		$mediaRecorder,
		// timer,
	};
}
