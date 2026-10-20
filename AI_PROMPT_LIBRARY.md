# AI Assistant Prompt Library for Surf IDE

## 📋 How to Use This Library

Copy the relevant prompt and paste it into any AI IDE (Cursor, Copilot, Claude, etc.) to onboard them to the task.

---

## 🎯 Prompt 1: Implement Phase 1 - Local Context Cache

```markdown
# Task: Implement Local Context Cache System for Surf IDE

## Context
You are working on Surf IDE, an AI-powered VSCode fork with offline-first architecture. The goal is to build a caching system that reduces API costs by 60%+ while maintaining response quality.

## What You Need to Build

### 1. Vector Database (SQLite + sqlite-vec)
Create `services/api/app/cache/vector_db.py`:
- SQLite database with vec0 extension
- Store 1536-dimensional embeddings
- Fast similarity search (<50ms)
- LRU eviction when cache exceeds 100MB

### 2. Embedding Generation
Create `services/api/app/cache/embeddings.py`:
- Use local embedding model (nomic-embed-text)
- Generate 1536-dim vectors from text
- Batch processing support
- Work 100% offline

### 3. Smart Router
Create `services/api/app/cache/router.py`:
- Check cache first (85% similarity threshold)
- If cache hit: return cached response ($0 cost)
- If cache miss + online: call cloud model, cache response
- If cache miss + offline: call local model, cache response
- Track cost savings

### 4. Tests
Create `services/api/tests/test_cache.py`:
- 15 unit tests (vector DB operations)
- 8 integration tests (routing logic)
- 3 E2E tests (user experience)
- Total: 26 tests, all must pass

## Technical Requirements

### Database Schema
```sql
CREATE TABLE chat_cache (
  id TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  query_embedding BLOB NOT NULL,
  response_text TEXT NOT NULL,
  source TEXT NOT NULL,
  model_used TEXT,
  cost_usd DECIMAL(10, 6),
  search_results JSON,
  code_examples JSON,
  created_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE chat_cache_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);
```

### API Endpoints
```python
POST /api/v1/chat                    # Smart-routed chat
GET  /api/v1/chat/analytics          # Usage analytics
POST /api/v1/chat/cache/search       # Search cache
```

### Performance Requirements
- Cache retrieval: <50ms
- Embedding generation: <200ms
- Response time (cached): <2s
- Response time (new): <5s
- Cache hit rate: >60%

## Success Criteria
✅ All 26 tests pass
✅ Cache retrieval <50ms
✅ Format similarity >95% (online vs offline)
✅ Cost savings >50%
✅ Works 100% offline

## Reference Files
- Read `AI_CONTEXT_MASTER.md` for full architecture
- Check `services/api/app/database.py` for MySQL patterns
- Check `services/api/app/models.py` for SQLAlchemy patterns

## Dependencies
```
sqlite-vec==0.1.0
numpy==2.1.3
sentence-transformers==2.2.2
```

Start by implementing vector_db.py, then embeddings.py, then router.py, then tests.
```

---

## 🎯 Prompt 2: Implement Phase 2 - Format Adapter

```markdown
# Task: Implement Format Adapter for Surf IDE

## Context
You are working on Surf IDE. The local Qwen model must respond with the same format/quality as ChatGPT/Claude. Users should not detect any difference between online and offline responses.

## What You Need to Build

### 1. Format Adapter
Create `apps/desktop/src/main/core/format-adapter.ts`:
- System prompt that forces Qwen to use markdown
- Code block formatting (always with language ID)
- Header/list/table standards
- Professional tone enforcement

### 2. Post-Processor
Create `apps/desktop/src/main/core/post-processor.ts`:
- Markdown validator
- Code block normalizer
- List formatter (convert * to -)
- Table aligner
- Whitespace cleanup

### 3. Format Validator
Create `apps/desktop/src/renderer/src/components/FormatValidator.tsx`:
- Real-time format checking
- Similarity score with ChatGPT format
- Visual diff display

### 4. Tests
Create `apps/desktop/tests/format-adapter.test.ts`:
- 18 unit tests (formatting rules)
- 6 integration tests (post-processing)
- 4 E2E tests (user perception)
- Total: 28 tests, all must pass

## Format Requirements

### System Prompt (for Qwen)
```
You are an AI assistant that must ALWAYS format responses with:

1. **Markdown Formatting:**
   - Use ## for main sections
   - Use ### for subsections
   - Use **bold** for emphasis
   - Use *italic* for subtle emphasis

2. **Code Blocks:**
   - Always use triple backticks with language identifier
   - Example: ```typescript
   - Include syntax highlighting hints

3. **Lists:**
   - Use bullet points (-) for unordered lists
   - Use numbers (1. 2. 3.) for ordered lists

4. **Tables:**
   - Use markdown tables for structured data
   - Align columns properly

5. **Response Structure:**
   - Start with brief summary (1-2 sentences)
   - Break into logical sections with headers
   - End with conclusion or next steps

NEVER output plain text without formatting. ALWAYS use markdown.
```

### Quality Metrics
- Format similarity with ChatGPT: >95%
- Code blocks with language ID: 100%
- Headers present: 100%
- Lists properly formatted: 100%
- Tables when needed: 100%

## Test Cases

### Unit Tests
```typescript
test('should always use markdown headers', async () => {
  const response = await localModel.generate('Explain React hooks');
  expect(response).toMatch(/^## /m);
});

test('should always use code blocks with language IDs', async () => {
  const response = await localModel.generate('Show me Python code');
  expect(response).toMatch(/```(python|py)\n/);
});

test('should use bullet points for lists', async () => {
  const response = await localModel.generate('List 5 benefits');
  expect(response).toMatch(/^[-*] /m);
});
```

### E2E Tests
```typescript
test('users should not detect difference between online/offline', async () => {
  const queries = [
    'Explain async/await',
    'How to handle errors in Python?',
    'Compare REST vs GraphQL'
  ];
  
  for (const query of queries) {
    const online = await callOpenRouter(query, 'gpt-4');
    const offline = await smartRoute(query);
    
    const formatSim = compareFormat(online, offline.response);
    expect(formatSim).toBeGreaterThan(0.95);
  }
});
```

## Success Criteria
✅ All 28 tests pass
✅ Format similarity >95%
✅ Code blocks always have language IDs
✅ Headers always present
✅ Lists properly formatted
✅ Users can't detect online vs offline

## Reference
- Read `AI_CONTEXT_MASTER.md` for full architecture
- Check `SURF_IDE_CURSOR_FEATURES.md` for Cursor comparison

Start by implementing format-adapter.ts, then post-processor.ts, then tests.
```

---

## 🎯 Prompt 3: Implement Phase 3 - Cache-Augmented Inference

```markdown
# Task: Implement Cache-Augmented Inference for Surf IDE

## Context
You are working on Surf IDE. The system should combine cached internet knowledge with local model reasoning to create enhanced responses that are better than either alone.

## What You Need to Build

### 1. Cache-Augmented Inference Engine
Create `apps/desktop/src/main/core/cache-augmented.ts`:
- Retrieve cached responses + search results
- Prepare context for local model
- Generate enhanced response
- Cache the new response

### 2. Context Builder
Create `apps/desktop/src/main/core/context-builder.ts`:
- Combine multiple cached queries
- Score relevance
- Format sources for citation
- Prepare code examples

### 3. Tests
Create `apps/desktop/tests/cache-augmented.test.ts`:
- 10 unit tests (context building)
- 7 integration tests (inference quality)
- 3 E2E tests (offline capability)
- Total: 20 tests, all must pass

## How It Works

### Flow
```
User Query: "How to implement authentication in Express.js?"
    ↓
Step 1: Search Cache for Similar Queries
    - Found: "Express.js authentication tutorial" (92% match)
    - Cached data: response + search results + code examples
    ↓
Step 2: Prepare Context
    - cached_response: "Use JWT tokens..."
    - cached_search_results: [StackOverflow, docs, tutorials]
    - cached_code_examples: ["const jwt = require('jwt')..."]
    ↓
Step 3: Local Model Generates Enhanced Response
    - Prompt: "Build upon cached knowledge, add your reasoning..."
    - Output: Comprehensive response with citations
    ↓
Step 4: Cache Enhanced Response
    - Store query + embedding + response + sources
    - Mark as source: 'cache_augmented'
```

### Context Preparation
```typescript
const context = {
  cached_response: similarCached[0].response,
  cached_search_results: similarCached[0].search_results.map(sr => 
    `[${sr.title}](${sr.url}) - ${sr.snippet}`
  ).join('\n'),
  cached_code_examples: similarCached[0].code_examples.map(ce => 
    `\`\`\`\n${ce}\n\`\`\``
  ).join('\n\n')
};
```

### Prompt to Local Model
```
You are an expert AI assistant. You have access to cached knowledge 
from previous internet searches and expert responses.

## Cached Knowledge

### Similar Previous Query:
"${similarCached[0].query}"

### Cached Response:
${similarCached[0].response}

### Sources Used:
${context.cached_search_results}

### Code Examples:
${context.cached_code_examples}

## New User Query:
"${query}"

## Your Task:
Generate a comprehensive response that:
1. Builds upon the cached knowledge
2. Adds your own expert reasoning
3. Includes improved code examples
4. Cites the cached sources
5. Updates with current best practices
```

## Quality Requirements

### Enhanced Response Must Have:
✅ References to cached sources
✅ Code examples (at least as many as cached)
✅ Markdown formatting (headers, lists, tables)
✅ Longer than local model alone
✅ Higher quality than local model alone

### Test Cases
```typescript
test('should combine cached knowledge with local reasoning', async () => {
  await cache.store(
    'How to implement JWT auth?',
    embedding1,
    'Use jsonwebtoken package...',
    {
      search_results: [
        { title: 'JWT.io', url: 'https://jwt.io', snippet: '...' }
      ]
    }
  );
  
  const result = await cacheAugmentedInference('JWT authentication tutorial');
  
  expect(result).toContain('JWT.io');
  expect(result).toContain('jsonwebtoken');
  expect(result.length).toBeGreaterThan(500);
});

test('should cite sources from cached search results', async () => {
  const result = await cacheAugmentedInference('React hooks best practices');
  
  expect(result).toMatch(/Sources?:/i);
  expect(result).toMatch(/https?:\/\//);
});

test('should produce higher quality than local model alone', async () => {
  const localOnly = await localModel.generate(query);
  const augmented = await cacheAugmentedInference(query);
  
  expect(augmented.length).toBeGreaterThan(localOnly.length);
});
```

## Success Criteria
✅ All 20 tests pass
✅ Enhanced responses cite sources
✅ Enhanced responses longer than local alone
✅ Works 100% offline
✅ Quality matches cloud model (95%+ similarity)

## Reference
- Read `AI_CONTEXT_MASTER.md` for full architecture
- Check `SURF_IDE_CURSOR_FEATURES.md` for feature details

Start by implementing context-builder.ts, then cache-augmented.ts, then tests.
```

---

## 🎯 Prompt 4: Write Comprehensive Tests

```markdown
# Task: Write Comprehensive Tests for Surf IDE

## Context
You are writing tests for Surf IDE, an AI-powered IDE with offline-first architecture. Every feature needs comprehensive test coverage.

## Test Requirements

### Total Tests: 156
- Unit Tests: 87
- Integration Tests: 40
- E2E Tests: 29

### Test Distribution by Feature
| Feature | Unit | Integration | E2E | Total |
|---------|------|-------------|-----|-------|
| Vector DB | 15 | 5 | 2 | 22 |
| Embeddings | 10 | 3 | 1 | 14 |
| Smart Routing | 12 | 8 | 3 | 23 |
| Format Adapter | 18 | 6 | 4 | 28 |
| Cache-Augmented | 10 | 7 | 3 | 20 |
| Analytics | 8 | 4 | 2 | 14 |
| Diagrams | 6 | 3 | 2 | 11 |
| Images | 8 | 4 | 2 | 14 |
| Quality Parity | 0 | 0 | 10 | 10 |

## Testing Frameworks

### Python (Backend)
```python
# pytest for unit/integration tests
import pytest
from app.cache.vector_db import VectorDB

@pytest.mark.asyncio
async def test_vector_db_store_and_retrieve():
    db = VectorDB()
    embedding = [0.1] * 1536
    await db.store('query1', embedding, 'response1')
    
    results = await db.search(embedding, threshold=0.95)
    assert len(results) == 1
    assert results[0].similarity > 0.95
```

### TypeScript (Desktop)
```typescript
// Jest for unit/integration tests
import { VectorDB } from './cache/vector-db';

describe('VectorDB', () => {
  test('should store and retrieve embeddings', async () => {
    const db = new VectorDB();
    const embedding = new Array(1536).fill(0.1);
    await db.store('query1', embedding, 'response1');
    
    const results = await db.search(embedding, { threshold: 0.95 });
    expect(results.length).toBe(1);
    expect(results[0].similarity).toBeGreaterThan(0.95);
  });
});

// Playwright for E2E tests
import { test, expect } from '@playwright/test';

test('user should not detect online/offline difference', async ({ page }) => {
  const onlineResponse = await callOpenRouter('test query');
  const offlineResponse = await smartRoute('test query');
  
  const similarity = compareFormat(onlineResponse, offlineResponse);
  expect(similarity).toBeGreaterThan(0.95);
});
```

## Test Categories

### Unit Tests
- Test individual functions in isolation
- Mock external dependencies
- Fast execution (<100ms per test)
- High coverage (90%+)

### Integration Tests
- Test multiple components working together
- Use real databases (SQLite in-memory)
- Moderate speed (<1s per test)
- Test data flow

### E2E Tests
- Test complete user workflows
- Use real models (Qwen, embeddings)
- Slower execution (<10s per test)
- Test user experience

## Quality Parity Tests (Critical)

```typescript
describe('Quality Parity', () => {
  test('users should not detect difference between online/offline', async () => {
    const queries = [
      'Explain async/await in JavaScript',
      'How to handle errors in Python?',
      'Compare REST vs GraphQL',
      'Write a React component example',
      'Design a database schema'
    ];
    
    for (const query of queries) {
      const online = await callOpenRouter(query, 'gpt-4');
      const offline = await smartRoute(query);
      
      // Format similarity
      const formatSim = compareFormat(online, offline.response);
      expect(formatSim).toBeGreaterThan(0.95);
      
      // Content quality
      expect(offline.response).toMatch(/## /);
      expect(offline.response).toMatch(/```/);
    }
  });

  test('response time should be <2s for cached, <5s for new', async () => {
    const start1 = Date.now();
    await smartRoute('cached query');
    const cachedTime = Date.now() - start1;
    expect(cachedTime).toBeLessThan(2000);
    
    const start2 = Date.now();
    await smartRoute('new query');
    const newTime = Date.now() - start2;
    expect(newTime).toBeLessThan(5000);
  });
});
```

## Performance Tests

```typescript
describe('Performance', () => {
  test('cache retrieval should be <50ms', async () => {
    const start = Date.now();
    await cache.search(embedding);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(50);
  });

  test('embedding generation should be <200ms', async () => {
    const start = Date.now();
    await generateEmbedding('test query');
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(200);
  });
});
```

## Offline Tests

```typescript
describe('Offline Capability', () => {
  beforeEach(() => {
    mockNetworkOffline();
  });

  test('should work 100% offline after setup', async () => {
    const response = await smartRoute('test query');
    expect(response).toBeDefined();
    expect(response.source).toBe('cache');
  });

  test('should generate embeddings offline', async () => {
    const embedding = await generateEmbedding('test');
    expect(embedding.length).toBe(1536);
  });
});
```

## Success Criteria
✅ All 156 tests pass
✅ 90%+ code coverage
✅ Performance tests pass (<50ms cache, <200ms embedding)
✅ Quality parity tests pass (>95% format similarity)
✅ Offline tests pass (100% offline capability)

## Reference
- Read `AI_CONTEXT_MASTER.md` for full architecture
- Check existing tests in `services/api/tests/` for patterns

Write tests in this order:
1. Unit tests (fastest, most coverage)
2. Integration tests (component interaction)
3. E2E tests (user experience)
4. Performance tests (speed requirements)
5. Offline tests (offline capability)
```

---

## 🎯 Prompt 5: General Onboarding (Any Task)

```markdown
# Task: General Onboarding for Surf IDE Development

## Context
You are joining the Surf IDE project. Before starting any task, you need to understand the architecture, goals, and implementation patterns.

## Step 1: Read These Documents
1. `AI_CONTEXT_MASTER.md` - Complete architecture and implementation plan
2. `SURF_IDE_CURSOR_FEATURES.md` - Cursor-like features design
3. `SURF_IDE_IMPLEMENTATION_GUIDE.md` - Step-by-step implementation guide
4. `services/api/MYSQL_AUTH_README.md` - MySQL auth system (already implemented)

## Step 2: Understand the Architecture
```
Surf IDE = VSCode Fork + Integrated AI (Offline + Online)

Core Innovation: Local Context Cache
- Cache all online responses (with embeddings)
- Retrieve cached responses for similar queries (85% similarity)
- Result: 60% cost reduction, <50ms response time, works offline
```

## Step 3: Know the Tech Stack
- **Backend:** Python 3.12, FastAPI, SQLAlchemy, MySQL, SQLite
- **Desktop:** Electron 44, React 19, TypeScript, Monaco Editor
- **Models:** Qwen 2.5 (offline), OpenRouter (online), nomic-embed-text
- **Testing:** pytest (Python), Jest (TypeScript), Playwright (E2E)

## Step 4: Understand the Goals
1. **Cost Efficiency:** 60%+ reduction in API costs
2. **Quality Parity:** 95%+ format similarity (online vs offline)
3. **Offline Capability:** 100% offline after initial setup
4. **User Experience:** Users shouldn't detect online/offline difference

## Step 5: Know the Implementation Phases
- **Phase 1:** Local Context Cache (vector DB, embeddings, smart routing)
- **Phase 2:** Format Adapter (Qwen → ChatGPT style)
- **Phase 3:** Cache-Augmented Inference (hybrid responses)
- **Phase 4:** Analytics Dashboard (usage tracking, cost savings)
- **Phase 5:** Diagram Generation (Mermaid.js, offline)
- **Phase 6:** Image Generation (Stable Diffusion, offline)
- **Phase 7:** E2E Quality Tests (user perception, parity)

## Step 6: Follow the Patterns
- **Offline-First:** Everything should work without internet
- **Cache-Augmented:** Combine cached knowledge with local reasoning
- **Format Parity:** Match cloud model quality (95%+ similarity)
- **Test-Driven:** Every feature needs comprehensive tests

## Step 7: Ask Questions
If anything is unclear, ask before implementing. Check:
- `AI_CONTEXT_MASTER.md` for architecture details
- Existing code for implementation patterns
- Test files for quality requirements

## Ready to Start
You now have full context. Ask the user what specific task you should implement.
```

---

## 📚 How to Use These Prompts

### **For Cursor/Copilot:**
1. Open the relevant file (e.g., `services/api/app/cache/vector_db.py`)
2. Paste the corresponding prompt
3. Let the AI generate the implementation
4. Review and test

### **For Claude/ChatGPT:**
1. Start a new conversation
2. Paste the prompt
3. Ask follow-up questions if needed
4. Copy the implementation to your codebase

### **For Any AI IDE:**
1. Read `AI_CONTEXT_MASTER.md` first
2. Use the relevant prompt from this library
3. Follow the implementation order
4. Write tests before submitting

---

## ✅ Success Criteria

**After using these prompts, the AI should:**
- ✅ Understand the full architecture
- ✅ Know the implementation phases
- ✅ Understand test requirements
- ✅ Follow design principles (offline-first, cache-augmented, format parity)
- ✅ Generate code that passes all tests
- ✅ Match the quality of existing codebase

**You should be able to:**
- ✅ Onboard any AI assistant in <5 minutes
- ✅ Get consistent implementations across different AI tools
- ✅ Maintain quality standards (95%+ format similarity)
- ✅ Achieve cost savings goals (60%+ reduction)
