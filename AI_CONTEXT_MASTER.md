# Surf IDE - Master Context for AI Assistants

## 🎯 Quick Summary (For AI Onboarding)

**Project:** Surf IDE - AI-powered VSCode fork with offline-first architecture  
**Goal:** Build a Cursor-competitive IDE that works offline, saves 60%+ on API costs, and provides seamless online/offline experience  
**Timeline:** 8 weeks  
**Current Status:** Backend auth complete (PR #41), starting Phase 1 implementation

---

## 🏗️ Architecture Overview

### **Core Innovation: Local Context Cache**
```
User Query → Check Cache (85% similarity) → Return cached response ($0 cost)
                ↓ (no cache hit)
        Check Internet → Use Cloud Model (GPT-4, $0.03) → Cache response
                ↓ (offline)
        Use Local Model (Qwen, $0) → Cache response
```

**Key Benefits:**
- 60-70% cost reduction (cached responses are free)
- <50ms cache retrieval (faster than API calls)
- Works 100% offline (after initial setup)
- Credits last 2-3x longer

---

## 📋 Implementation Phases

### **Phase 1: Local Context Cache System** (Week 1-2)
**Files to Create:**
- `services/api/app/cache/vector_db.py` - SQLite + sqlite-vec
- `services/api/app/cache/embeddings.py` - Local embedding generation
- `services/api/app/cache/router.py` - Smart routing logic
- `services/api/tests/test_cache.py` - 59 test cases

**Key Features:**
1. Vector database (1536-dim embeddings)
2. Similarity search (>85% threshold)
3. Cache-first routing
4. Cost tracking

**Test Requirements:**
- 15 unit tests (vector DB operations)
- 8 integration tests (routing logic)
- 3 E2E tests (user experience)

---

### **Phase 2: Format Adapter** (Week 2-3)
**Files to Create:**
- `apps/desktop/src/main/core/format-adapter.ts` - Qwen → ChatGPT style
- `apps/desktop/src/main/core/post-processor.ts` - Markdown normalizer
- `apps/desktop/src/renderer/src/components/FormatValidator.tsx` - UI validator
- `apps/desktop/tests/format-adapter.test.ts` - 28 test cases

**Key Features:**
1. System prompt engineering (force markdown)
2. Code block formatting (always with language ID)
3. Header/list/table standards
4. 95% format similarity with ChatGPT

**Test Requirements:**
- 18 unit tests (formatting rules)
- 6 integration tests (post-processing)
- 4 E2E tests (user perception)

---

### **Phase 3: Cache-Augmented Inference** (Week 3-4)
**Files to Create:**
- `apps/desktop/src/main/core/cache-augmented.ts` - Hybrid inference
- `apps/desktop/src/main/core/context-builder.ts` - Context preparation
- `apps/desktop/tests/cache-augmented.test.ts` - 20 test cases

**Key Features:**
1. Retrieve cached search results with responses
2. Combine cached knowledge + local reasoning
3. Source citation from cached data
4. Higher quality than local model alone

**Test Requirements:**
- 10 unit tests (context building)
- 7 integration tests (inference quality)
- 3 E2E tests (offline capability)

---

### **Phase 4: Analytics Dashboard** (Week 4-5)
**Files to Create:**
- `apps/desktop/src/renderer/src/screens/AnalyticsDashboard.tsx` - UI
- `apps/desktop/src/main/core/usage-tracker.ts` - Tracking logic
- `apps/desktop/src/main/core/cost-calculator.ts` - Savings calculator
- `apps/desktop/tests/analytics.test.ts` - 14 test cases

**Key Features:**
1. Query counter (total, cached, cloud, local)
2. Cost calculator (actual vs without cache)
3. Cache hit rate tracker
4. Response time logger

---

### **Phase 5: Diagram Generation** (Week 5-6)
**Files to Create:**
- `apps/desktop/src/main/core/diagram-generator.ts` - Mermaid integration
- `apps/desktop/src/main/core/diagram-templates.ts` - Templates
- `apps/desktop/tests/diagram.test.ts` - 11 test cases

**Key Features:**
1. Architecture diagrams (Mermaid.js)
2. Flowcharts
3. Sequence diagrams
4. 100% offline capability

---

### **Phase 6: Image Generation** (Week 6-7)
**Files to Create:**
- `apps/desktop/src/main/core/image-generator.ts` - Stable Diffusion
- `apps/desktop/src/main/core/model-downloader.ts` - Model management
- `apps/desktop/tests/image.test.ts` - 14 test cases

**Key Features:**
1. Stable Diffusion XL Turbo (2.5GB model)
2. One-time download (requires internet)
3. 100% offline after download
4. Fallback to text descriptions

---

### **Phase 7: E2E Quality Tests** (Week 7-8)
**Files to Create:**
- `apps/desktop/tests/e2e/quality-parity.test.ts` - 10 test cases
- `apps/desktop/tests/e2e/performance.test.ts` - Speed tests
- `apps/desktop/tests/e2e/user-perception.test.ts` - Blind tests

**Key Features:**
1. Users can't detect online vs offline difference
2. Format similarity >95%
3. Response time <2s (cached), <5s (new)
4. Cost savings >50%

---

## 🗄️ Database Schema

### **MySQL Tables** (Already Implemented)
```sql
-- Users table
CREATE TABLE users (
  id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  provider ENUM('google', 'github', 'email') NOT NULL,
  -- ... other fields
);

-- Chat history
CREATE TABLE chat_history (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  role ENUM('user', 'assistant', 'system') NOT NULL,
  content TEXT NOT NULL,
  source ENUM('online', 'offline', 'cache') DEFAULT 'online',
  -- ... other fields
);

-- Chat embeddings (for semantic search)
CREATE TABLE chat_embeddings (
  id VARCHAR(255) PRIMARY KEY,
  chat_id VARCHAR(255) NOT NULL,
  query_text TEXT NOT NULL,
  embedding TEXT NOT NULL, -- JSON array of 1536 floats
  -- ... other fields
);
```

### **Local SQLite** (To Implement)
```sql
-- Vector cache (user's device only)
CREATE TABLE chat_cache (
  id TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  query_embedding BLOB NOT NULL, -- 1536-dim vector
  response_text TEXT NOT NULL,
  source TEXT NOT NULL, -- 'online_gpt4', 'offline_qwen', 'cache_augmented'
  model_used TEXT,
  cost_usd DECIMAL(10, 6),
  search_results JSON, -- Internet results used
  code_examples JSON,
  created_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE chat_cache_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);
```

---

## 🔌 API Endpoints

### **Authentication** (Already Implemented)
```
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/auth/google
POST /api/v1/auth/google/callback
GET  /api/v1/auth/github
POST /api/v1/auth/github/callback
GET  /api/v1/auth/me
POST /api/v1/auth/logout
```

### **Chat** (To Implement)
```
POST /api/v1/chat                    # Smart-routed chat
POST /api/v1/chat/stream             # Streaming chat
GET  /api/v1/chat/history            # Get chat history
GET  /api/v1/chat/analytics          # Usage analytics
POST /api/v1/chat/cache/search       # Search cache
```

---

## 🧪 Test Coverage Requirements

**Total Tests:** 156
- Unit Tests: 87
- Integration Tests: 40
- E2E Tests: 29

**Coverage by Feature:**
| Feature | Tests | Status |
|---------|-------|--------|
| Vector DB | 22 | ⏳ Not Started |
| Embeddings | 14 | ⏳ Not Started |
| Smart Routing | 23 | ⏳ Not Started |
| Format Adapter | 28 | ⏳ Not Started |
| Cache-Augmented | 20 | ⏳ Not Started |
| Analytics | 14 | ⏳ Not Started |
| Diagrams | 11 | ⏳ Not Started |
| Images | 14 | ⏳ Not Started |
| Quality Parity | 10 | ⏳ Not Started |

---

## 📦 Tech Stack

### **Backend**
- Python 3.12
- FastAPI
- SQLAlchemy 2.0.36 (async)
- MySQL (pymysql, aiomysql)
- SQLite + sqlite-vec (local cache)
- NumPy (vector operations)

### **Desktop**
- Electron 44
- React 19
- TypeScript
- Monaco Editor (VSCode fork)
- llama.cpp (local models)
- Mermaid.js (diagrams)
- Stable Diffusion (images)

### **Models**
- **Text:** Qwen 2.5 Coder (offline)
- **Embeddings:** nomic-embed-text (1536-dim)
- **Images:** Stable Diffusion XL Turbo (2.5GB)
- **Cloud:** OpenRouter (GPT-4, Claude, etc.)

---

## 🎯 Success Metrics

### **Performance**
- Cache retrieval: <50ms
- Embedding generation: <200ms
- Response time (cached): <2s
- Response time (new): <5s

### **Quality**
- Format similarity (online vs offline): >95%
- Cache hit rate: >60%
- User satisfaction: >4.5/5

### **Cost**
- Cost reduction: >50%
- Credits last: 2-3x longer
- API calls reduced: 60%

---

## 📚 Key Files to Reference

### **Architecture Decisions**
- `docs/adr/0006-surf-ide-vscode-fork.md` - VSCode fork decision
- `SURF_IDE_CURSOR_FEATURES.md` - Cursor-like features
- `SURF_AI_LANDING_PAGE_PLAN.md` - Landing page design

### **Implementation Guides**
- `SURF_IDE_IMPLEMENTATION_GUIDE.md` - Step-by-step guide
- `services/api/MYSQL_AUTH_README.md` - MySQL auth setup
- `PHASE2_IMPLEMENTATION.md` - Phase 2 overview

### **Code Samples**
- `services/api/app/auth_service.py` - OAuth implementation
- `services/api/app/database.py` - MySQL connection
- `services/api/app/models.py` - SQLAlchemy models

---

## 🚀 Getting Started (For AI Assistants)

### **If you're asked to implement Phase 1:**
1. Read this document first
2. Check `services/api/app/cache/` directory (create if needed)
3. Implement vector_db.py with sqlite-vec
4. Implement embeddings.py with local model
5. Implement router.py with smart routing
6. Write 59 test cases in test_cache.py
7. Ensure all tests pass before submitting

### **If you're asked to implement Phase 2:**
1. Read this document first
2. Check `apps/desktop/src/main/core/format-adapter.ts`
3. Implement format adapter with system prompt
4. Implement post-processor for markdown normalization
5. Write 28 test cases
6. Ensure 95% format similarity with ChatGPT

### **If you're asked to write tests:**
1. Check the test count requirements above
2. Write unit tests first, then integration, then E2E
3. Use pytest for Python, Jest for TypeScript
4. Ensure 100% coverage of critical paths
5. Test offline scenarios explicitly

---

## 💡 Key Design Principles

1. **Offline-First:** Everything should work without internet (after initial setup)
2. **Cache-Augmented:** Combine cached knowledge with local reasoning
3. **Format Parity:** Local responses must match cloud quality (95%+ similarity)
4. **Cost Efficiency:** 60%+ cost reduction through caching
5. **User Transparency:** Users shouldn't feel online vs offline difference
6. **Privacy-First:** All data stays on user's device
7. **Test-Driven:** Every feature needs comprehensive tests

---

## 📞 Quick Reference

**Current Branch:** `feature/mysql-auth-backend`  
**Next Branch:** `feature/local-context-cache`  
**PR Status:** #41 in review (auth backend)  
**Next Task:** Implement Phase 1 (vector DB + smart routing)

**Key Contacts:**
- User: Product owner, wants offline-first IDE
- AI Assistant: Implement features with comprehensive tests

---

## 🎓 For AI Assistants: How to Use This Document

1. **Before implementing any feature:** Read this entire document
2. **Check test requirements:** Each phase has specific test counts
3. **Follow design principles:** Offline-first, cache-augmented, format parity
4. **Reference existing code:** Check implemented features for patterns
5. **Ask for clarification:** If anything is unclear, ask before implementing

**Remember:** The goal is to build an IDE that saves 60%+ on API costs while providing the same quality as cloud-only solutions. Every feature must support this goal.
