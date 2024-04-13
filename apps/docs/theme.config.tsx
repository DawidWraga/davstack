import React from 'react';
import { DocsThemeConfig } from 'nextra-theme-docs';
import { useRouter } from 'next/router';
import { BsStack } from 'react-icons/bs';
const config = {
	logo: (
		<>
			<BsStack size={20} />
			<span
				style={{
					fontWeight: '700',
					fontSize: '1.3rem',
					marginLeft: '0.5rem',
				}}
			>
				Davstack
			</span>
		</>
	),
	project: {
		link: 'https://github.com/DawidWraga/davstack',
	},
	chat: {
		link: 'https://discord.gg/tsW7YfH5vT',
	},
	docsRepositoryBase: 'https://github.com/DawidWraga/davstack',
	footer: {
		text: 'Davstack© 2024',
	},
	useNextSeoProps() {
		const { asPath } = useRouter();

		if (asPath !== '/') {
			return {
				titleTemplate: '%s – Davstack',
			};
		} else {
			return {
				title: 'Davstack',
			};
		}
	},
} satisfies DocsThemeConfig;

export default config;
