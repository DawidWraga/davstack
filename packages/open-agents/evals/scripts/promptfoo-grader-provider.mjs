import { spawnSync } from 'node:child_process';

export default class GeminiGraderProvider {
  constructor(options) {
    this.config = options.config || {};
  }

  id() {
    return 'gemini-grader';
  }

  async callApi(prompt, context) {
    try {
      const result = spawnSync('gemini', ['-m', 'gemini-3.1-flash-lite-preview', '--skip-trust'], {
        input: prompt,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });

      if (result.error) {
        return { error: `Spawn error: ${result.error.message}` };
      }
      if (result.status !== 0) {
        return { error: `Gemini exited with status ${result.status}: ${result.stderr || result.stdout}` };
      }

      // Clean up tool setup logging warnings from output if any
      let outputText = result.stdout || '';
      outputText = outputText.replace(/Ripgrep is not available\. Falling back to GrepTool\.\r?\n?/g, '').trim();

      return { output: outputText };
    } catch (e) {
      return { error: `Grader exception: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}
