// better-sqlite3-multiple-ciphers ships index.d.ts but its package.json "exports" hides it from
// moduleResolution NodeNext. Its API is a superset of better-sqlite3, so reuse @types/better-sqlite3.
declare module 'better-sqlite3-multiple-ciphers' {
  import Database = require('better-sqlite3');
  export = Database;
}
