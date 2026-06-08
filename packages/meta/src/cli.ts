import { defineCli } from '@davstack/cli-utils';
import { cliSpec } from './cli-spec.js';

const code = await defineCli(cliSpec).run(process.argv.slice(2));
process.exit(code);
