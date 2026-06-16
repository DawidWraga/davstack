```ts
fn(['CallSaveManager', key])
  .options({
    retry: {
      maxRetries: 5,
      backoffFactor: 3
    }
  })
  .input({...})
```

for now not implemented as changing the ai calls to be sequentail rather than parallel (and adding small delay beetween ai calls) inside @save-call-manger has sovled the issue
(i think, lets see if issue comes up agian in future)

retries are built into ai package but could be helpful to add as general reusable functioanlity to fn

INSPIRATION (each one of tehse files also has tests that i could copy, just give credit at top of file):

https://github.com/vercel/ai/blob/main/packages/ai/core/prompt/prepare-retries.ts

```ts
import { InvalidArgumentError } from '../../errors/invalid-argument-error';
import {
	RetryFunction,
	retryWithExponentialBackoff,
} from '../../util/retry-with-exponential-backoff';

/**
 * Validate and prepare retries.
 */
export function prepareRetries({
	maxRetries,
}: {
	maxRetries: number | undefined;
}): {
	maxRetries: number;
	retry: RetryFunction;
} {
	if (maxRetries != null) {
		if (!Number.isInteger(maxRetries)) {
			throw new InvalidArgumentError({
				parameter: 'maxRetries',
				value: maxRetries,
				message: 'maxRetries must be an integer',
			});
		}

		if (maxRetries < 0) {
			throw new InvalidArgumentError({
				parameter: 'maxRetries',
				value: maxRetries,
				message: 'maxRetries must be >= 0',
			});
		}
	}

	const maxRetriesResult = maxRetries ?? 2;

	return {
		maxRetries: maxRetriesResult,
		retry: retryWithExponentialBackoff({ maxRetries: maxRetriesResult }),
	};
}
```

SOURCE 2: https://github.com/vercel/ai/blob/main/packages/ai/util/retry-with-exponential-backoff.ts

how the factor works:

1. Increase Retry Factor: Changing the exponential backoff factor from 2 to 5 could help, but:
   With factor 2: intervals grow like 1s, 2s, 4s, 8s...
   With factor 5: intervals grow much faster: 1s, 5s, 25s, 125s...
   This gives Claude more time to recover between retries

```ts
import { APICallError } from '@ai-sdk/provider';
import { delay, getErrorMessage, isAbortError } from '@ai-sdk/provider-utils';
import { RetryError } from './retry-error';

export type RetryFunction = <OUTPUT>(
	fn: () => PromiseLike<OUTPUT>
) => PromiseLike<OUTPUT>;

/**
The `retryWithExponentialBackoff` strategy retries a failed API call with an exponential backoff.
You can configure the maximum number of retries, the initial delay, and the backoff factor.
 */
export const retryWithExponentialBackoff =
	({
		maxRetries = 2,
		initialDelayInMs = 2000,
		backoffFactor = 2,
	} = {}): RetryFunction =>
	async <OUTPUT>(f: () => PromiseLike<OUTPUT>) =>
		_retryWithExponentialBackoff(f, {
			maxRetries,
			delayInMs: initialDelayInMs,
			backoffFactor,
		});

async function _retryWithExponentialBackoff<OUTPUT>(
	f: () => PromiseLike<OUTPUT>,
	{
		maxRetries,
		delayInMs,
		backoffFactor,
	}: { maxRetries: number; delayInMs: number; backoffFactor: number },
	errors: unknown[] = []
): Promise<OUTPUT> {
	try {
		return await f();
	} catch (error) {
		if (isAbortError(error)) {
			throw error; // don't retry when the request was aborted
		}

		if (maxRetries === 0) {
			throw error; // don't wrap the error when retries are disabled
		}

		const errorMessage = getErrorMessage(error);
		const newErrors = [...errors, error];
		const tryNumber = newErrors.length;

		if (tryNumber > maxRetries) {
			throw new RetryError({
				message: `Failed after ${tryNumber} attempts. Last error: ${errorMessage}`,
				reason: 'maxRetriesExceeded',
				errors: newErrors,
			});
		}

		if (
			error instanceof Error &&
			APICallError.isInstance(error) &&
			error.isRetryable === true &&
			tryNumber <= maxRetries
		) {
			await delay(delayInMs);
			return _retryWithExponentialBackoff(
				f,
				{ maxRetries, delayInMs: backoffFactor * delayInMs, backoffFactor },
				newErrors
			);
		}

		if (tryNumber === 1) {
			throw error; // don't wrap the error when a non-retryable error occurs on the first try
		}

		throw new RetryError({
			message: `Failed after ${tryNumber} attempts with non-retryable error: '${errorMessage}'`,
			reason: 'errorNotRetryable',
			errors: newErrors,
		});
	}
}
```
