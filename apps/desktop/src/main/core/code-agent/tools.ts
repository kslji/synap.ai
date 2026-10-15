/**
 * Tool names and OpenAI-style schemas for the Code agent.
 * Schemas are a constant so the native tool-call prefix stays cacheable.
 */

export const CODE_TOOL_NAMES = [
  'read_file',
  'list_dir',
  'search_project',
  'propose_edit',
  'run_command',
  'finish',
] as const

export type CodeToolName = typeof CODE_TOOL_NAMES[number]

export function isCodeTool(name: string): name is CodeToolName {
  return (CODE_TOOL_NAMES as readonly string[]).includes(name)
}

export function codeToolSchemas(): readonly unknown[] {
  return SCHEMAS
}

const SCHEMAS = [
  fn('read_file', 'Read a text file inside the project. Use start_line and end_line to keep the reply short.', {
    path: { type: 'string' },
    start_line: { type: 'integer' },
    end_line: { type: 'integer' },
  }, ['path']),
  fn('list_dir', 'List one directory inside the project. path defaults to the project root.', {
    path: { type: 'string' },
  }, []),
  fn('search_project', 'Search the project for a short query. Returns snippets and file paths, not whole files.', {
    query: { type: 'string' },
  }, ['query']),
  fn('propose_edit', 'Propose a unified diff. The file is not written until the user applies it. Pass diff, or old and new text.', {
    path: { type: 'string' },
    diff: { type: 'string' },
    old: { type: 'string' },
    new: { type: 'string' },
  }, ['path']),
  fn('run_command', 'Run one program with arguments. No pipes, redirects, or shell syntax. The user must allow it first.', {
    command: { type: 'string' },
  }, ['command']),
  fn('finish', 'Stop the loop and give the user a short summary of what changed.', {
    summary: { type: 'string' },
  }, ['summary']),
] as const

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    },
  }
}
