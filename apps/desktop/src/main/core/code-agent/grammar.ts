/**
 * Grammar-constrained tool calls for models that miss native tool_calls.
 * llama.cpp accepts either json_schema (response_format) or a GBNF grammar.
 */
import { CODE_TOOL_NAMES } from './tools.js'
import type { ToolCallResponseFormat } from '@surf/agent-core'

// The structured-output constraint shape is the shared @surf/agent-core contract.
export type { ToolCallResponseFormat } from '@surf/agent-core'

export function toolCallJsonSchema(): ToolCallResponseFormat {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'code_tool_call',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: [...CODE_TOOL_NAMES] },
          arguments: { type: 'object' },
        },
        required: ['tool', 'arguments'],
      },
    },
  }
}

/** One JSON object: {"tool":"<name>","arguments":{...}}. */
export function toolCallGbnf(): string {
  const names = CODE_TOOL_NAMES.map((name) => `"\\"${name}\\""`).join(' | ')
  return [
    `root ::= "{" ws "\\"tool\\"" ws ":" ws toolname ws "," ws "\\"arguments\\"" ws ":" ws object ws "}"`,
    `toolname ::= ${names}`,
    'ws ::= [ \\t\\n]*',
    'object ::= "{" ws (pair (ws "," ws pair)*)? ws "}"',
    'pair ::= string ws ":" ws value',
    'array ::= "[" ws (value (ws "," ws value)*)? ws "]"',
    'value ::= string | number | object | array | "true" | "false" | "null"',
    'string ::= "\\"" ([^"\\\\] | "\\\\" .)* "\\""',
    'number ::= "-"? [0-9]+ ("." [0-9]+)?',
  ].join('\n')
}
