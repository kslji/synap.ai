---
language: rust
library: rust
version: original
source_url: https://synap.surf/code-pack/cards/rust
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## Result question mark

Result is Ok or Err. The ? operator returns the error early from a function that returns Result. It also converts the error with From when the types differ. Use it instead of matching every call when the caller should handle the failure.

## Option unwrap

Option is Some or None. unwrap panics on None. expect attaches a message to that panic. Prefer matching, if let, or unwrap_or when None is a normal case. Use expect only when None means a bug and the message explains the invariant.

## Vec index

Vec::push adds an element at the end. Indexing with [] panics if out of range. get returns Option and does not panic. len is the number of elements. Capacity can be larger than len after reserve.

## cargo test

cargo test runs the package tests. Tests live in the same crate behind #[cfg(test)] or in tests/*.rs as integration tests. A failed assert panics the test. cargo test name filters by the test name.
