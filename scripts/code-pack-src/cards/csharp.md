---
language: csharp
library: csharp
version: original
source_url: https://synap.surf/code-pack/cards/csharp
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## string alias

In C#, string is an alias for System.String. The two names are the same type. Strings are immutable. A method that looks like it changes a string returns a new string. StringComparison.Ordinal is the comparison to use for identifiers and paths when culture rules are not wanted.

## Nullable string

A nullable reference string? may be null when the nullable context is enabled. The compiler warns when you dereference it without a check. string without the question mark should not be null. Enable nullable in the project file with <Nullable>enable</Nullable>.

## await async

await requires the method to be async and returns control until the task finishes. The method's return type is Task or Task<T>, or ValueTask. Do not block on the task with .Result on a context that the task needs. await the task instead.
