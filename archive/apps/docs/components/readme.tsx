// @ts-expect-error
import StoreReadmeRaw from '../../../packages/store/README.md';

export function StoreReadme() {
	console.log('StoreReadmeRaw', StoreReadmeRaw);

	if (!StoreReadmeRaw) {
		return null;
	}
	return <StoreReadmeRaw />;
}
