---
language: typescript
library: typescript
version: original
source_url: https://synap.surf/code-pack/cards/typescript
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## TS2304

TS2304 means Cannot find name. The identifier is not declared in scope, or it is not imported. Check the spelling and the import. A type-only name imported without import type still needs to be a value if the code uses it at runtime.

## TS2322

TS2322 means the type is not assignable to the expected type. The value's type does not fit the annotation or the parameter. Read the two types in the message. A missing field, a wider union, or a string where a number is required are common causes. Narrow the value or change the annotation.

## TS2339

TS2339 means Property does not exist on this type. The object type has no such property. A typo, a union that includes a member without that field, or an any-shaped value that was given a narrower type will do this. Narrow the union before reading the field.

## strictNullChecks

With strictNullChecks, a value typed T | null must be narrowed before use. An if (value) check, a comparison with null, or optional chaining does that. Assigning null to a T parameter is an error. undefined is separate from null unless the type includes it.

## strict true

"strict": true in tsconfig turns on strictNullChecks, noImplicitAny, and the other strict flags as one group. noImplicitAny reports a parameter or variable that TypeScript would otherwise type as any. Turn the group on for new code. Fix the reported lines rather than silencing the flag for the whole project.
