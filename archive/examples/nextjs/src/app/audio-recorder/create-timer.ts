import { state } from '@davstack/store';

export type CreateTimerOptions = {
	/**
	 * Milliseconds between each interval tick
	 * @default 1000
	 */
	interval?: number;
};

export function createTimer(opts: CreateTimerOptions = {}) {
	const { interval = 1000 } = opts;
	const $intervalsPassed = state(0);
	const $startTime = state<number | undefined>(undefined);
	const $animationFrameId = state<number | undefined>(undefined);

	function start() {
		$startTime.set(performance.now());
		$animationFrameId.set(requestAnimationFrame(updateTimer));
	}

	function updateTimer() {
		const elapsed = performance.now() - $startTime.get()!;
		const intervalsPassed = Math.floor(elapsed / interval);
		$intervalsPassed.set(intervalsPassed);
		$animationFrameId.set(requestAnimationFrame(updateTimer));
	}

	function stop() {
		const animationFrameId = $animationFrameId.get();
		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			$animationFrameId.set(undefined);
		}
	}

	function reset() {
		$intervalsPassed.set(0);
		$startTime.set(undefined);
	}

	return {
		$intervalsPassed,
		start,
		stop,
		reset,
	};
}
