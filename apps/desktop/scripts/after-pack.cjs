/**
 * Ad-hoc sign the Mac app (`codesign -s -`) so Apple Silicon will launch it.
 * A real Developer ID is optional and off unless CSC_LINK is set. See docs/RELEASE.md.
 */
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK) return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = join(context.appOutDir, appName)
  try { execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' }) }
  catch { /* xattr is only there to clear quarantine bits before the ad-hoc signature */ }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
