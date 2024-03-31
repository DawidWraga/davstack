import { AppPropsType } from 'next/dist/shared/lib/utils';
import { CustomPosthogProvider } from '../components/custom-posthog-provider';

export default function App({ Component, pageProps }: AppPropsType) {
	return (
		<CustomPosthogProvider>
			<Component {...pageProps} />
		</CustomPosthogProvider>
	);
}
