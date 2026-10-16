# Country lookup file

The desktop app loads `dbip-country-lite.cidr` from this folder only when the file is present. A missing file means region detection falls through to worldwide sources. There is no hardcoded country.

The file is not committed. Generate it with `node scripts/fetch-dbip-country.mjs` from `apps/desktop`. DB-IP Lite is CC BY 4.0. Attribution: [DB-IP](https://db-ip.com/).

Each line is `start end CC` or `a.b.c.d/prefix CC`.
