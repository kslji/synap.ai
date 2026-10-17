---
language: java
library: java
version: original
source_url: https://synap.surf/code-pack/cards/java
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## ArrayList

java.util.ArrayList is a resizable array and is not synchronized. Do not share one across threads without external locking. CopyOnWriteArrayList or a concurrent collection is the alternative when threads both read and write. get and set are index based. add appends.

## HashMap null

HashMap allows one null key and many null values. ConcurrentHashMap does not allow a null key or a null value. A HashMap is not a concurrent map. For a cache shared by threads, use ConcurrentHashMap and its atomic methods.

## Checked exceptions

A checked exception must be caught or declared. The method signature lists it with throws. RuntimeException and its subclasses are unchecked. Catch the specific type you can handle. Do not catch Exception and ignore it.
