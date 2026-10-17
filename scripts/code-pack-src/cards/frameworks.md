---
language: javascript
library: react
version: original
source_url: https://synap.surf/code-pack/cards/frameworks
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## React useState {library=react}

React useState returns the current state and a setter. const [value, setValue] = useState(0). The setter replaces that state and schedules a render. Do not mutate the state object and expect a render. Pass a new object or array. A setter that receives a function gets the previous state.

## Next.js server components {library=nextjs}

In the Next.js App Router, components in the app directory are Server Components unless the file starts with 'use client'. A Server Component can await data on the server and does not ship that function to the browser. Add 'use client' at the top of a file that uses useState, event handlers, or browser-only APIs. That file and the components it imports as client components run in the browser.

## Express middleware {library=express}

Express middleware runs in the order you app.use it. Each function takes req, res, and next. Call next() to continue to the next middleware. A handler that sends a response should not also call next unless an error handler must run. A route mounted at a prefix runs after middleware registered before that route.

## npm and the lockfile

See the JavaScript card for the lockfile. npm install writes package-lock.json. Run npm commands from the directory that contains the package.json you mean.
