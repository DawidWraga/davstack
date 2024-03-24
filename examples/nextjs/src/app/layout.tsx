import Link from 'next/link';
import './globals.css';

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body>
				<div className="grid place-content-center w-screen h-screen relative">
					{children}
					<Link
						className="absolute bottom-10 left-1/2 transform -translate-x-1/2 text-xl"
						href="/"
					>
						home
					</Link>
				</div>
			</body>
		</html>
	);
}
