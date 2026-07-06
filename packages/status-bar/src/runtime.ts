import { renderStatusLine, type StatusLineInput } from './render.js'

async function main() {
	const chunks: Buffer[] = []
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
	const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as StatusLineInput
	process.stdout.write(renderStatusLine(input, Date.now() / 1000) + '\n')
}

main().catch((err) => {
	console.error('davstack-status-bar:', err instanceof Error ? err.message : err)
	process.exit(1)
})
