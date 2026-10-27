/**
 * The files that turn a throwaway eval folder into a project with a check.
 *
 * The ladder in `split.ts` only fixes what `checks.ts` can see, and a text rule in a fixture only
 * scores what it is written to look for. Every fixture therefore gets `npm run typecheck`, which
 * shells out to the repo's own TypeScript, and a real test command: `npm test` runs `node --test`
 * through the repo's tsx loader, so a behavioural fixture test executes the TypeScript directly and
 * fails with its own assertion message.
 */
export interface EvalProjectOptions {
  /** Globs the typecheck covers. */
  include?: string[]
  /** The command behind `npm test`, when this fixture has a behavioural test. */
  test?: string
}

export function evalProjectFiles(tscBin: string, options: EvalProjectOptions = {}): Record<string, string> {
  const scripts: Record<string, string> = { typecheck: `node ${JSON.stringify(tscBin)} --noEmit` }
  if (options.test) scripts.test = options.test
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
    include: options.include ?? ['src'],
  }
  return {
    'package.json': `${JSON.stringify({ private: true, scripts }, null, 2)}\n`,
    'tsconfig.json': `${JSON.stringify(tsconfig, null, 2)}\n`,
  }
}

/**
 * `npm test` for a fixture: node's own runner, on the repo's TypeScript loader. A test file named
 * `check.test.ts` imports `./src/math` the way the fixture does, with no extension and no build.
 */
export function evalTestCommand(loader: string, files: readonly string[]): string {
  return `node --import ${JSON.stringify(`file://${loader}`)} --test ${files.join(' ')}`
}
