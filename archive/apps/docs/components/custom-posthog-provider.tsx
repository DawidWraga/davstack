/* eslint-disable turbo/no-undeclared-env-vars */
/* eslint-disable no-undef */
import { useRouter } from 'next/router';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect } from 'react';

// Check that PostHog is client-side (used to handle Next.js SSR)
if (typeof window !== 'undefined') {
	/**
	 * The env vars are not available in the browser, so we need to hardcode the key here. They are NEXT_PUBLIC_ prefixed anyway so it's not a big deal.
	 *
	 * Alternatively could use https://github.com/t3-oss/t3-env as it supports client-side env vars.
	 */
	// posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
	posthog.init('phc_dzrTzS4S8mQgrBlxZ6a8YDaz4X9xp04svIoXPSJNznG', {
		api_host: 'https://eu.posthog.com',
		loaded: (posthog) => {
			if (process.env.NODE_ENV === 'development') posthog.debug();
		},
	});
}

function useCapturePageView() {
	const router = useRouter();
	useEffect(() => {
		const handleRouteChange = () => posthog?.capture('$pageview');
		router.events.on('routeChangeComplete', handleRouteChange);
		return () => {
			router.events.off('routeChangeComplete', handleRouteChange);
		};
	}, []);
}

export function CustomPosthogProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	useCapturePageView();
	return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
