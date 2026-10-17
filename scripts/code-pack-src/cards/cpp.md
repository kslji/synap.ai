---
language: cpp
library: cpp
version: original
source_url: https://synap.surf/code-pack/cards/cpp
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## vector at

std::vector::at throws std::out_of_range when the index is out of range. operator[] does not check and is undefined when the index is out of range. Use at when a bad index is a recoverable error. push_back and emplace_back append. size is the number of elements.

## unique_ptr

std::unique_ptr owns one object and deletes it when the unique_ptr is destroyed. Use std::make_unique to create one. Copying a unique_ptr is not allowed. std::move transfers ownership. A custom deleter is the second template argument when the pointer did not come from new.

## Range for

A range-based for loop walks a container from begin to end. for (const auto& item : values) does not copy each element. The container must stay alive for the whole loop. Do not erase elements with a range-based loop unless the container defines that as safe.
