import Link from 'next/link';

export interface AppPageProps {}

export default function AppPage(props: AppPageProps) {
	const {} = props;

	return (
		<>
			<div className="flex flex-col gap-2 p-5 ">
				<Link href="/book-store">Book Store</Link>
				<Link href="/counter">Counter</Link>
				<Link href="/todo">Todo</Link>
				<Link href="/todo-with-sound">Todo with sound</Link>
			</div>
		</>
	);
}
