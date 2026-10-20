# Code Assistance

<cite>
**Referenced Files in This Document**
- [languages.ts](file://apps/desktop/src/main/core/code/languages.ts)
- [parse.ts](file://apps/desktop/src/main/core/code/parse.ts)
- [scan.ts](file://apps/desktop/src/main/core/code/scan.ts)
- [project.ts](file://apps/desktop/src/main/core/code/project.ts)
- [search.ts](file://apps/desktop/src/main/core/code/search.ts)
- [chunks.ts](file://apps/desktop/src/main/core/code/chunks.ts)
- [context.ts](file://apps/desktop/src/main/core/code/context.ts)
- [store.ts](file://apps/desktop/src/main/core/code/store.ts)
- [embed.ts](file://apps/desktop/src/main/core/code/embed.ts)
- [lsp.ts](file://apps/desktop/src/main/core/code/lsp.ts)
- [watch.ts](file://apps/desktop/src/main/core/code/watch.ts)
- [limits.ts](file://apps/desktop/src/main/core/code/limits.ts)
- [fetch-tree-sitter.mjs](file://apps/desktop/scripts/fetch-tree-sitter.mjs)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document explains the code assistance features in Surf.ai, focusing on the syntax parsing system built on tree-sitter, the project scanning and indexing pipeline, hybrid search combining full-text and semantic understanding, context-aware completion hints, and integration with development workflows through file watching and incremental updates. It also documents supported languages, configuration options, and known limitations for binary files, generated code, and non-standard formats.

## Project Structure
The code assistance subsystem lives under the desktop application’s main process core:

```mermaid
graph TB
subgraph "Code Assistance Core"
L["languages.ts"]
P["parse.ts"]
S["scan.ts"]
W["watch.ts"]
C["chunks.ts"]
R["search.ts"]
X["project.ts"]
D["store.ts"]
E["embed.ts"]
Y["lsp.ts"]
M["limits.ts"]
end
X --> S
X --> P
X --> R
X --> D
X --> E
X --> Y
X --> W
P --> L
P --> M
S --> L
S --> M
R --> D
R --> E
C --> M
D --> E
```

**Diagram sources**
- [project.ts:56-216](file://apps/desktop/src/main/core/code/project.ts#L56-L216)
- [parse.ts:1-528](file://apps/desktop/src/main/core/code/parse.ts#L1-L528)
- [scan.ts:1-161](file://apps/desktop/src/main/core/code/scan.ts#L1-L161)
- [search.ts:1-85](file://apps/desktop/src/main/core/code/search.ts#L1-L85)
- [chunks.ts:1-94](file://apps/desktop/src/main/core/code/chunks.ts#L1-L94)
- [store.ts:1-392](file://apps/desktop/src/main/core/code/store.ts#L1-L392)
- [embed.ts:1-53](file://apps/desktop/src/main/core/code/embed.ts#L1-L53)
- [lsp.ts:1-168](file://apps/desktop/src/main/core/code/lsp.ts#L1-L168)
- [watch.ts:1-35](file://apps/desktop/src/main/core/code/watch.ts#L1-L35)
- [languages.ts:1-59](file://apps/desktop/src/main/core/code/languages.ts#L1-L59)
- [limits.ts:1-62](file://apps/desktop/src/main/core/code/limits.ts#L1-L62)

**Section sources**
- [project.ts:56-216](file://apps/desktop/src/main/core/code/project.ts#L56-L216)
- [parse.ts:1-528](file://apps/desktop/src/main/core/code/parse.ts#L1-L528)
- [scan.ts:1-161](file://apps/desktop/src/main/core/code/scan.ts#L1-L161)
- [search.ts:1-85](file://apps/desktop/src/main/core/code/search.ts#L1-L85)
- [chunks.ts:1-94](file://apps/desktop/src/main/core/code/chunks.ts#L1-L94)
- [store.ts:1-392](file://apps/desktop/src/main/core/code/store.ts#L1-L392)
- [embed.ts:1-53](file://apps/desktop/src/main/core/code/embed.ts#L1-L53)
- [lsp.ts:1-168](file://apps/desktop/src/main/core/code/lsp.ts#L1-L168)
- [watch.ts:1-35](file://apps/desktop/src/main/core/code/watch.ts#L1-L35)
- [languages.ts:1-59](file://apps/desktop/src/main/core/code/languages.ts#L1-L59)
- [limits.ts:1-62](file://apps/desktop/src/main/core/code/limits.ts#L1-L62)

## Core Components
- Language detection and grammar mapping: maps file extensions to language identifiers and provides grammar filenames for tree-sitter.
- Syntax parsing: uses web-tree-sitter to extract symbols, imports, calls, and references per language.
- Project scanning: walks directories, respects .gitignore, skips binaries and oversized files, and classifies each file.
- Indexing and storage: persists files, symbols, edges, chunks, and vectors into a local SQLite database.
- Hybrid search: merges BM25 keyword results with vector similarity using reciprocal rank fusion.
- Context building: selects snippets within token budgets for model prompts.
- Completion hints: returns imported and nearby definitions for inline suggestions.
- Optional LSP integration: attempts exact references via pyright or typescript-language-server when available.
- File watching: coalesces events and triggers incremental re-indexing.

**Section sources**
- [languages.ts:1-59](file://apps/desktop/src/main/core/code/languages.ts#L1-L59)
- [parse.ts:1-528](file://apps/desktop/src/main/core/code/parse.ts#L1-L528)
- [scan.ts:1-161](file://apps/desktop/src/main/core/code/scan.ts#L1-L161)
- [store.ts:1-392](file://apps/desktop/src/main/core/code/store.ts#L1-L392)
- [search.ts:1-85](file://apps/desktop/src/main/core/code/search.ts#L1-L85)
- [context.ts:1-120](file://apps/desktop/src/main/core/code/context.ts#L1-L120)
- [project.ts:158-216](file://apps/desktop/src/main/core/code/project.ts#L158-L216)
- [lsp.ts:1-168](file://apps/desktop/src/main/core/code/lsp.ts#L1-L168)
- [watch.ts:1-35](file://apps/desktop/src/main/core/code/watch.ts#L1-L35)

## Architecture Overview
The system follows a pipeline: scan → parse → index → embed → search → context → completion hints. A background watcher triggers incremental updates.

```mermaid
sequenceDiagram
participant FS as "File System"
participant Watch as "watch.ts"
participant Proj as "project.ts"
participant Scan as "scan.ts"
participant Parse as "parse.ts"
participant Store as "store.ts"
participant Embed as "embed.ts"
participant Search as "search.ts"
participant Ctx as "context.ts"
FS-->>Watch : file change events
Watch->>Proj : onChange(rels[])
Proj->>Scan : classifyFile()
Scan-->>Proj : ScannedFile | null
Proj->>Parse : parseSource(language, text)
Parse-->>Proj : ParseResult {symbols, edges}
Proj->>Store : writeFileIndex(file)
Proj->>Embed : embedPending()
Embed-->>Proj : markEmbedded()
Note over Proj,Search : Search can run between embedding batches
Search->>Store : FTS + vector queries
Search-->>Ctx : ranked hits
Ctx-->>Proj : context pack (snippets, files)
```

**Diagram sources**
- [watch.ts:1-35](file://apps/desktop/src/main/core/code/watch.ts#L1-L35)
- [project.ts:132-140](file://apps/desktop/src/main/core/code/project.ts#L132-L140)
- [project.ts:280-319](file://apps/desktop/src/main/core/code/project.ts#L280-L319)
- [project.ts:321-347](file://apps/desktop/src/main/core/code/project.ts#L321-L347)
- [search.ts:63-84](file://apps/desktop/src/main/core/code/search.ts#L63-L84)
- [context.ts:65-119](file://apps/desktop/src/main/core/code/context.ts#L65-L119)

## Detailed Component Analysis

### Syntax Parsing System (tree-sitter)
The parser initializes web-tree-sitter once, loads WASM grammars on demand, and extracts:
- Symbols: functions, classes, methods, types, variables, sections
- Imports: per-language import patterns
- Calls: call sites and constructors
- References: identifier usages excluding definitions and import statements

It falls back to plain-text sectioning when a language is unsupported or parsing fails.

```mermaid
flowchart TD
Start(["parseSource(language, source)"]) --> CheckLang{"language supported?"}
CheckLang --> |No| Plain["parsePlain(source)"]
CheckLang --> |Yes| Init["initParser()"]
Init --> Load["loadLanguage(language)"]
Load --> HasLang{"grammar loaded?"}
HasLang --> |No| Plain
HasLang --> |Yes| ParseTree["parser.parse(source)"]
ParseTree --> TreeOk{"tree valid?"}
TreeOk --> |No| Plain
TreeOk --> Extract["extractImports/symbols/calls/refs"]
Extract --> Result["return ParseResult"]
Plain --> Result
```

**Diagram sources**
- [parse.ts:138-160](file://apps/desktop/src/main/core/code/parse.ts#L138-L160)
- [parse.ts:502-528](file://apps/desktop/src/main/core/code/parse.ts#L502-L528)
- [parse.ts:466-499](file://apps/desktop/src/main/core/code/parse.ts#L466-L499)

Key implementation highlights:
- Grammar loading is cached per language; parser instance reused.
- Language-specific specs define symbol nodes, class nodes, and call node fields.
- Import extraction handles Python, JavaScript/TypeScript/TSX, Java, Go, Rust, C/C++.
- Call and reference extraction are capped per file to limit memory and CPU.

**Section sources**
- [parse.ts:1-528](file://apps/desktop/src/main/core/code/parse.ts#L1-L528)
- [languages.ts:48-59](file://apps/desktop/src/main/core/code/languages.ts#L48-L59)
- [fetch-tree-sitter.mjs:1-30](file://apps/desktop/scripts/fetch-tree-sitter.mjs#L1-L30)

### Language Support Matrix
Supported programming languages and mappings:
- Python: .py, .pyi
- JavaScript: .js, .jsx, .mjs, .cjs
- TypeScript: .ts
- TSX: .tsx
- Java: .java
- Go: .go
- Rust: .rs
- C: .c, .h
- C++: .cc, .cpp, .cxx, .hpp, .hh, .hxx

Plaintext fallback applies to prose and config-like files such as markdown, JSON, YAML, TOML, CSS, HTML, shell scripts, SQL, XML, Ruby, Swift, Kotlin, Scala, Lua, Vim script, Emacs Lisp, and special base names like Dockerfile, Makefile, Gemfile, etc.

Grammar WASM files are pinned versions fetched by a build script and loaded at runtime.

**Section sources**
- [languages.ts:3-46](file://apps/desktop/src/main/core/code/languages.ts#L3-L46)
- [languages.ts:48-59](file://apps/desktop/src/main/core/code/languages.ts#L48-L59)
- [fetch-tree-sitter.mjs:1-30](file://apps/desktop/scripts/fetch-tree-sitter.mjs#L1-L30)

### Project Scanning and Indexing
Scanning:
- Walks the project root recursively.
- Respects nested .gitignore rules.
- Skips dependency/build directories, secrets, lockfiles, and binary extensions.
- Detects binary content by sampling bytes and line length heuristics.
- Enforces limits on file size, total bytes, and number of files.

Indexing:
- Reads each file, computes SHA-256, parses it, splits symbols into chunks, and writes file metadata, symbols, edges, and chunks to SQLite.
- Links import and call edges to concrete symbols and paths post-parse.
- Batches embeddings for pending chunks and marks them embedded.

```mermaid
flowchart TD
ScanStart(["scanProject(root)"]) --> Walk["walk(dir, relDir, matchers)"]
Walk --> EntryCheck{"entry type"}
EntryCheck --> |Dir| DirRules["skip dirs / apply .gitignore"]
EntryCheck --> |File| FileRules["check name/ext/binary/size/language"]
FileRules --> Accept{"accept file?"}
Accept --> |Yes| Collect["collect ScannedFile"]
Accept --> |No| Skip["increment ignored/binaries/tooBig"]
Collect --> Next["continue walk"]
DirRules --> Next
Skip --> Next
Next --> Done["sort & return stats"]
```

**Diagram sources**
- [scan.ts:71-123](file://apps/desktop/src/main/core/code/scan.ts#L71-L123)

Indexing flow:
```mermaid
flowchart TD
IStart(["indexAll()"]) --> ScanFiles["scanProject(root)"]
ScanFiles --> ForEach["for each file"]
ForEach --> Read["readFileSync(text)"]
Read --> Hash["digest(text)"]
Hash --> Changed{"hash differs from DB?"}
Changed --> |No| NextFile["next file"]
Changed --> |Yes| Parse["parseSource(language, text)"]
Parse --> Chunks["chunksFor(symbols)"]
Chunks --> Write["writeFileIndex(...)"]
Write --> Link["linkEdges(db)"]
Link --> Embed["embedPending()"]
Embed --> Ready["state = ready"]
```

**Diagram sources**
- [project.ts:245-319](file://apps/desktop/src/main/core/code/project.ts#L245-L319)
- [project.ts:321-347](file://apps/desktop/src/main/core/code/project.ts#L321-L347)

**Section sources**
- [scan.ts:1-161](file://apps/desktop/src/main/core/code/scan.ts#L1-L161)
- [project.ts:245-319](file://apps/desktop/src/main/core/code/project.ts#L245-L319)
- [project.ts:321-347](file://apps/desktop/src/main/core/code/project.ts#L321-L347)
- [store.ts:73-105](file://apps/desktop/src/main/core/code/store.ts#L73-L105)
- [store.ts:231-326](file://apps/desktop/src/main/core/code/store.ts#L231-L326)
- [limits.ts:1-62](file://apps/desktop/src/main/core/code/limits.ts#L1-L62)

### Code Search: Full-Text + Semantic
Search combines:
- BM25 keyword search over chunk text via SQLite FTS.
- Vector similarity search over chunk embeddings.
- Reciprocal Rank Fusion (RRF) to merge ranks.
- Name boosting for identifiers matching query tokens and higher weight for function/method/class/type kinds.

```mermaid
flowchart TD
Q["searchCode(query, qvec)"] --> FTS["BM25 keyword ids"]
Q --> Vec["vector distance ids"]
FTS --> Fuse["fuseRanks(keywordIds, vectorHits)"]
Vec --> Fuse
Fuse --> Fetch["SELECT chunks for fused ids"]
Fetch --> Rerank["rerankHits(hits, query)"]
Rerank --> Top["slice(k)"]
```

**Diagram sources**
- [search.ts:28-60](file://apps/desktop/src/main/core/code/search.ts#L28-L60)
- [search.ts:63-84](file://apps/desktop/src/main/core/code/search.ts#L63-L84)

**Section sources**
- [search.ts:1-85](file://apps/desktop/src/main/core/code/search.ts#L1-L85)

### Context Building for Model Prompts
Context builder:
- Embeds the task if an embedder is provided.
- Runs hybrid search to collect candidate snippets.
- Adds exact definitions for identifiers found in the task.
- Augments with related files and their top symbols.
- Applies token budgeting and truncation to fit constraints.

```mermaid
flowchart TD
Build["buildContext(task, options)"] --> EmbedQ["embedQueries([task])?"]
EmbedQ --> Search["searchCode(db, task, qvec)"]
Search --> Idents["extract identifiers from task"]
Idents --> Defs["definitions(ident)"]
Search --> Merge["merge hits + defs + related"]
Merge --> Budget["token budgeting + truncate"]
Budget --> Pack["ContextPack {snippets, files, tokens, dropped}"]
```

**Diagram sources**
- [context.ts:65-119](file://apps/desktop/src/main/core/code/context.ts#L65-L119)

**Section sources**
- [context.ts:1-120](file://apps/desktop/src/main/core/code/context.ts#L1-L120)

### Code Completion Hints
Completion hints provide:
- Imported symbols resolved to definitions.
- Nearby definitions above the cursor line.
These are used by the editor-facing completion service to populate context-aware suggestions.

```mermaid
sequenceDiagram
participant Editor as "Editor"
participant Proj as "project.ts"
participant Store as "store.ts"
Editor->>Proj : completionHints(path, line)
Proj->>Store : importedDefinitions(path, limit)
Store-->>Proj : SymbolHit[]
Proj->>Store : nearbyDefinitions(path, line, limit)
Store-->>Proj : SymbolHit[]
Proj-->>Editor : {imported, nearby}
```

**Diagram sources**
- [project.ts:205-211](file://apps/desktop/src/main/core/code/project.ts#L205-L211)
- [store.ts:150-182](file://apps/desktop/src/main/core/code/store.ts#L150-L182)

**Section sources**
- [project.ts:205-211](file://apps/desktop/src/main/core/code/project.ts#L205-L211)
- [store.ts:150-182](file://apps/desktop/src/main/core/code/store.ts#L150-L182)

### Optional LSP Integration
When pyright-langserver or typescript-language-server is available on PATH:
- The system spawns the server, initializes it, opens the target file, and requests references.
- On success, returns precise locations; otherwise, falls back to the tree-sitter graph.

```mermaid
sequenceDiagram
participant Caller as "project.ts"
participant LSP as "lsp.ts"
participant Server as "pyright/typescript-language-server"
Caller->>LSP : lspReferences({command, args, root, file, languageId, line})
LSP->>Server : initialize
LSP->>Server : initialized
LSP->>Server : textDocument/didOpen
LSP->>Server : textDocument/references
Server-->>LSP : locations[]
LSP-->>Caller : {source : 'lsp', items}
Note over LSP,Server : Timeout or error -> fallback to graph
```

**Diagram sources**
- [lsp.ts:69-157](file://apps/desktop/src/main/core/code/lsp.ts#L69-L157)
- [project.ts:179-199](file://apps/desktop/src/main/core/code/project.ts#L179-L199)

**Section sources**
- [lsp.ts:1-168](file://apps/desktop/src/main/core/code/lsp.ts#L1-L168)
- [project.ts:179-199](file://apps/desktop/src/main/core/code/project.ts#L179-L199)

### File Watching and Incremental Updates
The watcher:
- Uses recursive fs.watch.
- Coalesces rapid events with a debounce timer.
- Normalizes paths and ignores .git directories.
- Batches changed relative paths to trigger incremental indexing.

```mermaid
flowchart TD
WStart["watchProject(root, onChange)"] --> FS["fs.watch(root, recursive)"]
FS --> Event["on change event"]
Event --> Normalize["normalize path, skip .git"]
Normalize --> Queue["add to pending set"]
Queue --> Debounce["setTimeout(debounceMs)"]
Debounce --> Emit["onChange(batch)"]
Emit --> Update["project.update(rels)"]
```

**Diagram sources**
- [watch.ts:5-34](file://apps/desktop/src/main/core/code/watch.ts#L5-L34)
- [project.ts:137-140](file://apps/desktop/src/main/core/code/project.ts#L137-L140)
- [project.ts:280-303](file://apps/desktop/src/main/core/code/project.ts#L280-L303)

**Section sources**
- [watch.ts:1-35](file://apps/desktop/src/main/core/code/watch.ts#L1-L35)
- [project.ts:137-140](file://apps/desktop/src/main/core/code/project.ts#L137-L140)
- [project.ts:280-303](file://apps/desktop/src/main/core/code/project.ts#L280-L303)

## Dependency Analysis
High-level dependencies among components:

```mermaid
graph LR
Languages["languages.ts"] --> Parse["parse.ts"]
Limits["limits.ts"] --> Scan["scan.ts"]
Limits --> Parse
Scan --> Project["project.ts"]
Parse --> Project
Search["search.ts"] --> Project
Store["store.ts"] --> Project
Embed["embed.ts"] --> Project
LSP["lsp.ts"] --> Project
Watch["watch.ts"] --> Project
Chunks["chunks.ts"] --> Store
```

**Diagram sources**
- [languages.ts:1-59](file://apps/desktop/src/main/core/code/languages.ts#L1-L59)
- [parse.ts:1-528](file://apps/desktop/src/main/core/code/parse.ts#L1-L528)
- [scan.ts:1-161](file://apps/desktop/src/main/core/code/scan.ts#L1-L161)
- [project.ts:1-349](file://apps/desktop/src/main/core/code/project.ts#L1-L349)
- [search.ts:1-85](file://apps/desktop/src/main/core/code/search.ts#L1-L85)
- [store.ts:1-392](file://apps/desktop/src/main/core/code/store.ts#L1-L392)
- [embed.ts:1-53](file://apps/desktop/src/main/core/code/embed.ts#L1-L53)
- [lsp.ts:1-168](file://apps/desktop/src/main/core/code/lsp.ts#L1-L168)
- [watch.ts:1-35](file://apps/desktop/src/main/core/code/watch.ts#L1-L35)
- [chunks.ts:1-94](file://apps/desktop/src/main/core/code/chunks.ts#L1-L94)
- [limits.ts:1-62](file://apps/desktop/src/main/core/code/limits.ts#L1-L62)

**Section sources**
- [project.ts:1-349](file://apps/desktop/src/main/core/code/project.ts#L1-L349)

## Performance Considerations
- Parser initialization is lazy and cached; WASM grammars are loaded on demand.
- Symbol and reference extraction are capped per file to prevent excessive memory usage.
- Chunking splits large symbols by word count with overlap to preserve context across slices.
- Embedding runs in small batches between search operations to keep latency low.
- Database uses WAL mode and foreign keys; vector extension is loaded for ANN search.
- Scanning enforces hard caps on file count, total bytes, and max file size.
- Watcher debounces events to avoid repeated indexing on save storms.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Grammar not found: ensure tree-sitter WASM grammars are present in the grammar directory; rebuild resources via the fetch script.
- Binary or minified files skipped: check limits for maxLineChars and BINARY_EXT; adjust CODE_LIMITS if necessary.
- Missing LSP references: verify pyright-langserver or typescript-language-server is installed and on PATH; the system will fall back to graph-based references.
- Stale index after edits: confirm watcher is active and debounce is configured; inspect project status for errors.
- Embedding failures: validate embedding dimension and batch sizes; check embedder availability and error messages.

**Section sources**
- [fetch-tree-sitter.mjs:1-30](file://apps/desktop/scripts/fetch-tree-sitter.mjs#L1-L30)
- [limits.ts:1-62](file://apps/desktop/src/main/core/code/limits.ts#L1-L62)
- [lsp.ts:1-168](file://apps/desktop/src/main/core/code/lsp.ts#L1-L168)
- [project.ts:105-123](file://apps/desktop/src/main/core/code/project.ts#L105-L123)
- [project.ts:321-347](file://apps/desktop/src/main/core/code/project.ts#L321-L347)

## Conclusion
Surf.ai’s code assistance layer combines robust tree-sitter parsing, efficient project scanning, hybrid search, and optional LSP precision to deliver accurate, fast, and scalable code intelligence. It supports multiple languages, integrates smoothly with developer workflows through file watching and incremental updates, and provides practical configuration points for performance tuning and scope control. Limitations around binary files, generated code, and non-standard formats are handled explicitly, ensuring predictable behavior across diverse codebases.