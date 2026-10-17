---
language: go
library: go
version: original
source_url: https://synap.surf/code-pack/cards/go
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## Error strings

Go error strings should not be capitalized and should not end with punctuation. They are often joined after other text. fmt.Errorf("open config: %w", err) wraps an error so errors.Is and errors.As can still match it. Return the error to the caller. Do not log and also return the same error unless the log is the last step.

## ListenAndServe

http.ListenAndServe(addr, handler) listens until it returns an error. The second argument nil uses DefaultServeMux. Register handlers with http.Handle or http.HandleFunc before calling it. A returned error other than a closed server is a failure to bind or accept. Check that error.

## go test

go test ./... runs tests in this module, including nested packages. A file named *_test.go in package foo holds tests for that package. t.Fatal stops the current test. t.Errorf reports and continues. Cache results are skipped when the inputs change.

## defer

defer runs the call when the function returns. Deferred calls run in last-in, first-out order. Use defer file.Close() after a successful open so the close happens on every return path. A deferred function sees the final values of named result parameters.
