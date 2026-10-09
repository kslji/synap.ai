/** SURF_* is the product prefix. HARBOR_* is still read so older notes and scripts keep working. */
export function surfEnv(name: string): string | undefined {
  const primary = process.env[`SURF_${name}`]
  if (primary != null && primary !== '') return primary
  const legacy = process.env[`HARBOR_${name}`]
  if (legacy != null && legacy !== '') return legacy
  return undefined
}
