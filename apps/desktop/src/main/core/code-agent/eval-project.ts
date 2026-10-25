/**
 * The two files that turn a throwaway eval folder into a project with a check.
 *
 * The ladder in `split.ts` only fixes what `checks.ts` can see, so an eval host whose
 * `runCommand` always says ok scores edits that do not compile. Every fixture therefore gets
 * `npm run typecheck`, which shells out to the repo's own TypeScript: nothing to install, and a
 * skipped second file shows up as a real diagnostic instead of a silent pass.
 */
export function evalProjectFiles(tscBin: string, include: string[] = ['src']): Record<string, string> {
  const scripts = { typecheck: `node ${JSON.stringify(tscBin)} --noEmit` }
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM'],
      noEmit: true,
      skipLibCheck: true,
      // Without strict a null return still satisfies `number`, and the half-done edit passes.
      strict: true,
    },
    include,
  }
  return {
    'package.json': `${JSON.stringify({ private: true, scripts }, null, 2)}\n`,
    'tsconfig.json': `${JSON.stringify(tsconfig, null, 2)}\n`,
  }
}
