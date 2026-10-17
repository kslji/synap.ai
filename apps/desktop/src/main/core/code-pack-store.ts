/**
 * Keyword index for the Code pack. Vectors are not stored here.
 * EmbeddingGemma builds a separate cache on the device.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import type { DB } from './db.js'

export interface CodePackChunkRow {
  id?: number
  language: string
  library: string
  version: string
  sourceUrl: string
  licence: string
  title: string
  heading: string
  citation: string
  text: string
}

export const CODE_PACK_SCHEMA = `
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  language TEXT NOT NULL,
  library TEXT NOT NULL,
  version TEXT NOT NULL,
  source_url TEXT NOT NULL,
  licence TEXT NOT NULL,
  title TEXT NOT NULL,
  heading TEXT NOT NULL,
  citation TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX idx_chunks_lang ON chunks(language);
CREATE INDEX idx_chunks_lib ON chunks(library);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  citation, heading, library, language, text,
  content='chunks', content_rowid='id',
  tokenize='unicode61'
);
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, citation, heading, library, language, text)
  VALUES (new.id, new.citation, new.heading, new.library, new.language, new.text);
END;
`

export function createCodePackDatabase(path: string): DB {
  const db = new Database(path)
  db.pragma('journal_mode = OFF')
  db.exec(CODE_PACK_SCHEMA)
  return db
}

export function insertCodePackChunks(db: DB, rows: CodePackChunkRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO chunks (language, library, version, source_url, licence, title, heading, citation, text)
    VALUES (@language, @library, @version, @sourceUrl, @licence, @title, @heading, @citation, @text)
  `)
  const tx = db.transaction((batch: CodePackChunkRow[]) => {
    for (const row of batch) stmt.run(row)
  })
  tx(rows)
}

export function openCodePackDatabase(path: string): DB {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  db.pragma('query_only = ON')
  return db
}
