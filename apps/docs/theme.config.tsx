import React from 'react';
import { DocsThemeConfig } from 'nextra-theme-docs';

const config = {
	logo: <span>DavStack</span>,
	project: {
		link: 'https://github.com/DawidWraga/davstack',
	},
	chat: {
		link: 'https://discord.com',
	},
	docsRepositoryBase: 'https://github.com/DawidWraga/davstack',
	footer: {
		text: 'DavStack© 2024',
	},
} satisfies DocsThemeConfig;

export default config;
