/**
 * Realistic coding questions for the Code pack eval.
 * `expect` strings are facts the pack is built to contain. The scorer checks
 * those strings. It does not invent a pass.
 */

export interface CodePackQuestion {
  id: string
  language: string
  libraries?: string[]
  question: string
  /** Every string must appear in the retrieved text, and in a pack-on answer. */
  expect: string[]
  /** When set, a correct answer refuses this call instead of describing it. */
  fakeApi?: string
}

export const CODE_PACK_QUESTIONS: CodePackQuestion[] = [
  { id: 'py-asyncio-run', language: 'python', question: 'How do I run a Python coroutine from synchronous code?', expect: ['asyncio.run', 'RuntimeError'] },
  { id: 'py-modulenotfound', language: 'python', question: 'What does ModuleNotFoundError mean in Python?', expect: ['ModuleNotFoundError', 'sys.path'] },
  { id: 'py-traceback', language: 'python', question: 'How do I read a Python traceback?', expect: ['newest frame last'] },
  { id: 'py-nonetype', language: 'python', question: "What does TypeError: 'NoneType' object is not subscriptable mean?", expect: ['returned None'] },
  { id: 'py-indent', language: 'python', question: 'What causes IndentationError in Python?', expect: ['indent does not match'] },
  { id: 'py-pytest-scope', language: 'python', libraries: ['pytest'], question: 'What is the default pytest fixture scope?', expect: ['default scope is function'] },
  { id: 'py-pip', language: 'python', libraries: ['pip'], question: 'How do I install the packages listed in requirements.txt?', expect: ['pip install -r requirements.txt'] },
  { id: 'py-path-encoding', language: 'python', question: 'How should I read a UTF-8 text file with pathlib?', expect: ["encoding='utf-8'"] },
  { id: 'js-fetch-ok', language: 'javascript', question: 'How do I check that fetch succeeded before reading JSON?', expect: ['response.ok'] },
  { id: 'js-promise-catch', language: 'javascript', question: 'How do I handle a rejected JavaScript promise?', expect: ['try/catch'] },
  { id: 'js-const', language: 'javascript', question: 'Can I reassign a const binding in JavaScript?', expect: ['const is not reassigned'] },
  { id: 'js-listener-once', language: 'javascript', question: 'How do I remove a DOM listener after it runs once?', expect: ['once: true'] },
  { id: 'ts-2304', language: 'typescript', question: 'What does TypeScript error TS2304 mean?', expect: ['TS2304', 'Cannot find name'] },
  { id: 'ts-2322', language: 'typescript', question: 'What does TypeScript error TS2322 mean?', expect: ['TS2322', 'not assignable'] },
  { id: 'ts-2339', language: 'typescript', question: 'What does TypeScript error TS2339 mean?', expect: ['TS2339', 'Property does not exist'] },
  { id: 'ts-null', language: 'typescript', question: 'What does strictNullChecks require before I use a T or null value?', expect: ['narrowed before use'] },
  { id: 'ts-strict', language: 'typescript', question: 'What does "strict": true turn on in tsconfig?', expect: ['strictNullChecks', 'noImplicitAny'] },
  { id: 'node-enoent', language: 'javascript', question: 'What does the Node.js error ENOENT mean?', expect: ['ENOENT', 'no such file'] },
  { id: 'node-eaddr', language: 'javascript', question: 'What does Node.js EADDRINUSE mean?', expect: ['EADDRINUSE', 'port is already'] },
  { id: 'node-esm', language: 'javascript', question: 'What does ERR_MODULE_NOT_FOUND mean for an ESM import?', expect: ['ERR_MODULE_NOT_FOUND', 'file extension'] },
  { id: 'node-type-module', language: 'javascript', question: 'What does "type": "module" in package.json do?', expect: ['makes .js files ESM'] },
  { id: 'go-error-string', language: 'go', question: 'How should Go error strings be capitalized?', expect: ['should not be capitalized'] },
  { id: 'go-listen', language: 'go', question: 'What happens if the handler passed to http.ListenAndServe is nil?', expect: ['DefaultServeMux'] },
  { id: 'go-test', language: 'go', question: 'How do I run every test in a Go module?', expect: ['go test ./...'] },
  { id: 'go-defer', language: 'go', question: 'When does a deferred Go call run?', expect: ['when the function returns'] },
  { id: 'rust-question', language: 'rust', question: 'What does the ? operator do on a Rust Result?', expect: ['returns the error early'] },
  { id: 'rust-option', language: 'rust', question: 'What does Option::unwrap do on None?', expect: ['panics on None'] },
  { id: 'rust-vec', language: 'rust', question: 'Does Vec indexing with [] check the range?', expect: ['panics if out of range'] },
  { id: 'rust-cargo', language: 'rust', question: 'How do I run the tests in a Rust package?', expect: ['cargo test'] },
  { id: 'java-arraylist', language: 'java', question: 'Is java.util.ArrayList synchronized?', expect: ['not synchronized'] },
  { id: 'java-hashmap', language: 'java', question: 'Does HashMap allow a null key?', expect: ['one null key'] },
  { id: 'java-checked', language: 'java', question: 'What must I do with a checked exception in Java?', expect: ['caught or declared'] },
  { id: 'c-malloc', language: 'c', question: 'What should I check after malloc?', expect: ['Check NULL'] },
  { id: 'c-printf', language: 'c', question: 'What does printf %s expect?', expect: ['%s expects a char'] },
  { id: 'c-string', language: 'c', question: 'How does a C string literal end?', expect: ['zero byte'] },
  { id: 'cpp-vector-at', language: 'cpp', question: 'What does std::vector::at throw when the index is out of range?', expect: ['std::out_of_range'] },
  { id: 'cpp-unique', language: 'cpp', question: 'How should I create a std::unique_ptr?', expect: ['std::make_unique'] },
  { id: 'cpp-range-for', language: 'cpp', question: 'What does a C++ range-based for loop walk?', expect: ['begin to end'] },
  { id: 'cs-string', language: 'csharp', question: 'What is the C# string alias?', expect: ['System.String'] },
  { id: 'cs-nullable', language: 'csharp', question: 'What does string? mean when nullable context is enabled?', expect: ['may be null'] },
  { id: 'cs-await', language: 'csharp', question: 'What does a method need so it can await?', expect: ['method to be async'] },
  { id: 'sql-ilike', language: 'sql', question: 'How do I do a case-insensitive LIKE in PostgreSQL?', expect: ['ILIKE'] },
  { id: 'sql-returning', language: 'sql', question: 'How do I get the inserted row back in PostgreSQL?', expect: ['RETURNING'] },
  { id: 'sql-rowid', language: 'sql', question: 'What is INTEGER PRIMARY KEY an alias for in SQLite?', expect: ['alias for the rowid'] },
  { id: 'sql-upsert', language: 'sql', question: 'How do I upsert in SQLite?', expect: ['ON CONFLICT DO UPDATE'] },
  { id: 'sql-distinct', language: 'sql', question: 'What does SELECT DISTINCT do?', expect: ['removes duplicate result rows'] },
  { id: 'bash-set', language: 'bash', question: 'What does set -euo pipefail do?', expect: ['pipefail'] },
  { id: 'bash-quote', language: 'bash', question: 'Why should I quote a shell variable?', expect: ['spaces do not split'] },
  { id: 'bash-path', language: 'bash', question: 'What does "command not found" mean in Bash?', expect: ['not on PATH'] },
  { id: 'git-not-repo', language: 'git', question: 'What does fatal: not a git repository mean?', expect: ['no .git'] },
  { id: 'git-detached', language: 'git', question: 'What is a detached HEAD in Git?', expect: ['not a branch'] },
  { id: 'git-ff', language: 'git', question: 'What does a non-fast-forward push rejection mean?', expect: ['remote has commits you do not have'] },
  { id: 'git-conflict', language: 'git', question: 'What do Git conflict markers look like?', expect: ['<<<<<<<'] },
  { id: 'html-button', language: 'html', question: 'What is the default type of a button inside a form?', expect: ['type="button"'] },
  { id: 'css-specificity', language: 'html', question: 'Which CSS selector wins: an id, a class, or an element?', expect: ['id selector beats a class'] },
  { id: 'react-state', language: 'javascript', libraries: ['react'], question: 'What does React useState return?', expect: ['current state and a setter'] },
  { id: 'next-server', language: 'javascript', libraries: ['nextjs'], question: 'When is a Next.js App Router component a Server Component?', expect: ["'use client'"] },
  { id: 'express-order', language: 'javascript', libraries: ['express'], question: 'In what order does Express run middleware?', expect: ['order you app.use'] },
  { id: 'django-debug', language: 'python', libraries: ['django'], question: 'What should Django DEBUG be in production?', expect: ['DEBUG must be False'] },
  { id: 'fastapi-path', language: 'python', libraries: ['fastapi'], question: 'Where do FastAPI path parameters come from?', expect: ['function arguments'] },
  { id: 'flask-route', language: 'python', libraries: ['flask'], question: 'Is the Flask development server the production server?', expect: ['not the production server'] },
  { id: 'jest-test', language: 'javascript', libraries: ['jest'], question: 'How do I declare a Jest test?', expect: ['test() and expect()'] },
  { id: 'vitest-api', language: 'javascript', libraries: ['vitest'], question: 'Do Vitest tests use the same test and expect names as Jest?', expect: ['same test and expect names'] },
  { id: 'npm-lock', language: 'javascript', libraries: ['npm'], question: 'What file does npm install write to lock versions?', expect: ['package-lock.json'] },
  { id: 'docker-cmd', language: 'docker', libraries: ['docker'], question: 'What is the exec form of Dockerfile CMD?', expect: ['JSON array'] },
  { id: 'docker-build', language: 'docker', libraries: ['docker'], question: 'How do I build an image from the Dockerfile in this directory?', expect: ['docker build -t'] },
  { id: 'py-fake-api', language: 'python', question: 'What does python.never.widgetize() return?', expect: [], fakeApi: 'widgetize' },
  { id: 'ts-fake-api', language: 'typescript', question: 'How does typescript.never.zorbulate() work?', expect: [], fakeApi: 'zorbulate' },
  { id: 'go-fake-api', language: 'go', question: 'What does fmt.never.glorp() return?', expect: [], fakeApi: 'glorp' },
]

export function codePackFactQuestions(): CodePackQuestion[] {
  return CODE_PACK_QUESTIONS.filter((question) => !question.fakeApi)
}
