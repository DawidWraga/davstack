const withNextra = require('nextra')({
	theme: 'nextra-theme-docs',
	themeConfig: './theme.config.tsx',
	mdxOptions: {
		pageExtensions: ['mdx', 'md'],
	},
});

module.exports = withNextra();
