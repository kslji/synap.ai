---
language: sql
library: sql
version: original
source_url: https://synap.surf/code-pack/cards/sql
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## PostgreSQL ILIKE

PostgreSQL ILIKE is a case-insensitive LIKE. WHERE name ILIKE 'ada%' matches Ada and ada. LIKE is case-sensitive unless you fold the case yourself. Prefer a parameter for the pattern so the user value is not concatenated into the SQL text.

## PostgreSQL RETURNING

PostgreSQL RETURNING gives back columns from the row the statement wrote. INSERT INTO notes (body) VALUES ($1) RETURNING id returns the new id. $1 is the first parameter for many client drivers. Do not build that value by gluing strings into the statement.

## SQLite rowid

In SQLite, INTEGER PRIMARY KEY is an alias for the rowid. The column is the row id, not a separate integer plus a hidden row id. Without the INTEGER PRIMARY KEY declaration, a primary key of another type does not replace the rowid.

## SQLite upsert

SQLite ON CONFLICT DO UPDATE is an upsert. INSERT INTO item (id, name) VALUES (1, 'a') ON CONFLICT(id) DO UPDATE SET name = excluded.name updates the existing row. INSERT OR REPLACE replaces the row and can delete and insert, which changes rowid behavior and fires different triggers. Prefer ON CONFLICT when you mean update.

## SELECT DISTINCT

SELECT DISTINCT removes duplicate result rows. Two rows that are equal in every selected column collapse to one. DISTINCT applies to the whole select list, not to one column, unless you use DISTINCT ON in PostgreSQL. Filter with WHERE before relying on DISTINCT to hide duplicates you should not have produced.
