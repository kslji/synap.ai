---
language: javascript
library: javascript
version: original
source_url: https://synap.surf/code-pack/cards/javascript
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## fetch response.ok

fetch() returns a Response even when the server responds with 404 or 500. Check response.ok before response.json(). response.ok is true for status 200 through 299. A network failure rejects the promise. An HTTP error status does not.

## Rejected promises

A rejected promise is an error. await the promise inside try/catch, or chain .catch. An unhandled rejection is reported by the runtime. Do not swallow the error with an empty catch if the caller needs to know.

## const and let

const is not reassigned. The binding stays fixed. The object it points at can still have its fields changed. let can be reassigned and is block scoped. var is function scoped and is the older form.

## once listeners

addEventListener takes an options object. once: true removes the listener after it runs once. You do not need a matching removeEventListener for that single call. passive: true tells the browser the listener will not call preventDefault.

## Node ENOENT

ENOENT means no such file or directory. The path does not exist, or a parent directory is missing. Check the working directory. Node resolves a relative path from process.cwd(), not from the file that contains the call, unless you build the path with import.meta.url or __dirname.

## Node EADDRINUSE

EADDRINUSE means the port is already taken. Another process is bound to that host and port. Stop that process or choose a different port. SO_REUSEADDR does not let two servers accept on the same address.

## ERR_MODULE_NOT_FOUND

ERR_MODULE_NOT_FOUND means an ESM import specifier did not resolve. For a relative import, include the file extension, for example ./util.js. Node does not add .js for you in ESM. A missing package also raises this error. Install it and check the export map.

## type module

package.json "type": "module" makes .js files ESM. import and export are the syntax. require is the CommonJS function and is not available in those files unless you use a createRequire bridge. A file named .cjs stays CommonJS. A file named .mjs stays ESM.

## Jest tests {library=jest}

Jest tests use test() and expect() to define a test. describe() groups tests. expect(value).toBe(other) uses Object.is. toEqual compares fields. A failing expect fails the test. Run npx jest from the package that contains the config.

## Vitest {library=vitest}

Vitest uses the same test and expect names as Jest and reads vite.config. A Vite project can run npx vitest. Globals are off unless the config sets globals: true. Import { test, expect } from 'vitest' when globals are off.

## npm lockfile {library=npm}

npm install reads package.json and writes package-lock.json. The lockfile records the resolved versions so a later install can repeat them. Commit the lockfile for an application. npm ci installs from the lockfile and fails if package.json and the lockfile disagree.
