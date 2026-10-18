/**
 * Print a new Ed25519 seed and its public key.
 * Put the seed in the GitHub Actions secret CODE_PACK_SIGNING_KEY.
 * Put the public key in apps/desktop/resources/pack-keys.json.
 * Do not commit the seed.
 */
import { publicHex, seedToPrivateKey } from './sign.ts'
import { randomBytes } from 'node:crypto'

const seed = randomBytes(32)
const pub = publicHex(seedToPrivateKey(seed))
process.stdout.write(`public ${pub}\n`)
process.stdout.write(`CODE_PACK_SIGNING_KEY=${seed.toString('hex')}\n`)
process.stdout.write('Store the seed in the GitHub secret. Do not commit it.\n')
