/**
 * Hook for the Code agent loop in draft PR #15
 * (branch cursor/code-agent-loop-7dfa, apps/desktop/src/main/core/code-agent/loop.ts).
 *
 * That loop is not on main yet. When it merges, register these tools only when
 * the list is non-empty. devWebTools() returns [] unless NODE_ENV=development
 * or SYNAP_DEV_WEB=1, so a production build never advertises the names.
 *
 * In code-agent/tools.ts, spread the schemas:
 *
 *   import { devWebToolSchemas } from './dev-web-hook.js'
 *   export function codeToolSchemas() {
 *     return [...SCHEMAS, ...devWebToolSchemas()]
 *   }
 *
 * In code-agent/loop.ts act(), before the unknown-tool branch:
 *
 *   import { codeAgentDevWebTools } from './dev-web-hook.js'
 *   const extra = codeAgentDevWebTools({ apiBase, offlineOnly, signal: host.signal })
 *   const tool = extra.find((item) => item.name === name)
 *   if (tool) return clip(host, await tool.run(args))
 *
 * apiBase comes from resolveSynapApiUrl(). Do not add web_search or fetch_page
 * to the production schema constant.
 */
import { devWebTools, type DevWebHost, type DevWebTool } from '../dev-web-tools.js'

export { devWebEnabled, devWebToolSchemas, devWebTools, parseDevWebCommand, resolveSynapApiUrl } from '../dev-web-tools.js'

export function codeAgentDevWebTools(host: DevWebHost): DevWebTool[] {
  return devWebTools(host)
}
