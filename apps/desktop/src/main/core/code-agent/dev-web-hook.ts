/**
 * Dev-only web tools for the Code agent loop.
 *
 * codeToolSchemas() spreads devWebToolSchemas(). act() dispatches
 * codeAgentDevWebTools() before the unknown-tool branch. Both lists are empty
 * unless NODE_ENV=development or SYNAP_DEV_WEB=1, so a production build never
 * advertises web_search or fetch_page. Those names stay out of the production
 * schema constant and the grammar enum.
 *
 * apiBase comes from the loop host when the desktop passes one, otherwise
 * resolveSynapApiUrl().
 */
import { devWebTools, type DevWebHost, type DevWebTool } from '../dev-web-tools.js'

export { devWebEnabled, devWebToolSchemas, devWebTools, parseDevWebCommand, resolveSynapApiUrl } from '../dev-web-tools.js'
export type { DevWebHost, DevWebTool } from '../dev-web-tools.js'

export function codeAgentDevWebTools(host: DevWebHost): DevWebTool[] {
  return devWebTools(host)
}
