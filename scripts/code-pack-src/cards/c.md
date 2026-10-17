---
language: c
library: c
version: original
source_url: https://synap.surf/code-pack/cards/c
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## malloc

malloc returns a pointer to the allocated bytes, or NULL if the allocation fails. Check NULL before using the pointer. free the pointer once. free(NULL) is a no-op. Do not use the pointer after free. sizeof on the pointed-to type is the usual size argument, multiplied by the count.

## printf

printf %s expects a char* that points at a zero-terminated string. %d expects an int. Passing the wrong type is undefined. A missing zero byte makes %s read off the end of the buffer. The return value is the number of characters written, or a negative value on error.

## String literal

A string literal is a char array ending with a zero byte. The type of "hi" decays to char* in many expressions, and the bytes must not be written. Copy it with a function that respects the destination size if you need a mutable buffer.
