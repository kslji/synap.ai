/** Prints the Step 11 case list. Exit 1 when any case fails. */
import { step11Cases } from './step11-cases.js'

const rows = step11Cases()
process.stdout.write(JSON.stringify(rows))
if (rows.some((row) => !row.fields.ok)) process.exit(1)
