<goal>Add an exported `triple` function to src/math.ts that takes one number and returns it multiplied by 3.</goal>
<context>Tiny throwaway TS repo. Match the existing file's style (it has both a `function` declaration and an arrow `const` export — either is fine).</context>
<scope>src/math.ts ONLY. Do not modify src/index.ts or any other file.</scope>
<acceptance>tsc --noEmit clean; `triple(n: number): number` exported from src/math.ts returning n * 3.</acceptance>
