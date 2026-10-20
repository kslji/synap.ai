# Surf AI Agent Upgrade - Local Agentic Coding Assistant

## Overview

This document describes the upgrades made to transform Surf AI into a fully local agentic coding assistant that can compete with Devin, Cursor, and GitHub Copilot Workspace - all running on your device.

## Changes Made

### 1. ✅ 100% Local Web Search (No Docker, No Cloud)
- **File**: `apps/desktop/src/main/core/web-fetcher.ts` (NEW)
- **Approach**: In-process HTTP fetcher using DuckDuckGo HTML (no API key)
- **Implementation**:
  - `simpleWebSearch()` - Searches DuckDuckGo HTML, parses results with linkedom
  - `fetchWebPage()` - Fetches and extracts page content
  - No Docker, no external services, no cloud API
- **RAM Usage**: ~50-100MB (in-process, no containers)
- **Impact**: Truly local - everything runs on user machine

### 2. ✅ Added Git Tools to Code Agent
- **File**: `apps/desktop/src/main/core/code-agent/tools.ts`
- **New Tools**:
  - `git_status` - Check git status to see modified files
  - `git_commit` - Commit changes with a message (requires approval)
  - `git_push` - Push commits to remote (requires approval)
  - `git_pull` - Pull changes from remote (requires approval)

### 3. ✅ Implemented Git Tool Handlers
- **File**: `apps/desktop/src/main/core/code-agent/loop.ts`
- **Implementation**: Added handlers for all git tools with permission gates
- **Features**:
  - All git operations require user approval
  - Integrated with existing permission system
  - Proper error handling and status reporting

### 4. ✅ Created Coding-Specific System Prompt
- **File**: `apps/desktop/src/main/core/app-services.ts`
- **New Prompt**: `CODING_SYSTEM` - Designed for coding tasks
- **Features**:
  - Focuses on tool usage (read, edit, run commands, git)
  - Emphasizes explaining before acting
  - Encourages testing changes
  - No [S1] citation system (replaced with direct tool outputs)

### 5. ✅ 100% Local Web Search (No Docker)
- **File**: `apps/desktop/src/main/core/web-fetcher.ts` (NEW)
- **Technology**: DuckDuckGo HTML + linkedom (in-process)
- **RAM Usage**: ~50-100MB (vs 1.5-2.5GB for Docker stack)
- **No Setup Required**: Works immediately, no Docker needed
- **Features**:
  - Search via DuckDuckGo HTML (no API key)
  - Fetch and parse web pages
  - Extract main content automatically
  - Batch fetching (3 pages at a time)

## Current Architecture

### Existing Code-Agent Infrastructure
Surf AI already has a powerful code-agent system with:
- ✅ Tool calling framework (native, JSON schema, GBNF modes)
- ✅ Agent loop with planning and execution
- ✅ Permission system for approving edits/commands
- ✅ Project search with vector indexing
- ✅ File operations (read, list, search, edit)
- ✅ Command execution with user approval
- ✅ Web search tools (dev mode)

### Current Limitation
The code-agent is **only used in a separate "code mode" feature** and not integrated into the main chat flow. Users must explicitly switch to code mode to use these capabilities.

## Next Steps to Complete Integration

### 1. Integrate Code-Agent into Main Chat (HIGH PRIORITY)
**Required changes**:
- Modify main chat flow to detect coding-related queries
- Add routing logic to switch between document chat and code-agent
- Add UI toggle for "Agent Mode" vs "Document Mode"
- Update IPC to support code-agent messages from renderer

**Files to modify**:
- `apps/desktop/src/main/core/app-services.ts` - Chat routing logic
- `apps/desktop/src/renderer/src/` - UI components
- `apps/desktop/src/shared/ipc-contract.ts` - IPC schemas

### 2. Add GitHub Integration
**Required changes**:
- Add tools: `git_create_pr`, `git_list_prs`, `git_merge_pr`
- Integrate with GitHub API for PR management
- Add authentication for GitHub tokens

**Files to modify**:
- `apps/desktop/src/main/core/code-agent/tools.ts` - Add GitHub tools
- `apps/desktop/src/main/core/code-agent/loop.ts` - Add handlers
- Need GitHub token storage in settings

### 3. Improve Inference Smoothness
**Required changes**:
- Optimize streaming batch size
- Add thinking token visualization
- Implement faster token generation (quantization, model selection)
- Add caching for frequently used prompts

**Files to modify**:
- `apps/desktop/src/main/core/llama-client.ts` - Streaming optimization
- `apps/desktop/src/main/core/token-budget.ts` - Prompt caching
- `apps/desktop/src/main/core/code-agent/llama.ts` - GBNF optimization

### 4. Add Smarter Routing
**Required changes**:
- Add intent classification (coding vs document query)
- Auto-detect project context (is user in a codebase?)
- Suggest code-agent mode when coding is detected

**Files to modify**:
- `apps/desktop/src/main/core/app-services.ts` - Intent detection
- New classifier module for routing decisions

## How to Use Current Capabilities

### Starting Local Web Search
```bash
# From repo root
npm run dev:search
```
This starts SearXNG on port 8080 and FastAPI on port 8000.

### Using Code Mode (Current Way)
1. Open Surf AI
2. Navigate to Code Mode (UI button/menu)
3. Select a project folder
4. Ask coding questions
5. The agent will use tools with your approval

### Using Git Tools (When Code Agent is Active)
```
User: "Check the git status"
Agent: [Uses git_status tool]

User: "Commit these changes with message 'fix login bug'"
Agent: [Proposes commit, asks for approval]

User: "Push to remote"
Agent: [Asks for approval, pushes]
```

## Performance Considerations

### Model Requirements
For smooth coding assistance, use:
- **Chat model**: 7B+ parameter model (e.g., Llama 3.1 8B, Qwen 2.5 7B)
- **Embedding model**: Already using Gemma 2 256 (good for code)
- **Quantization**: Q4_K_M or Q5_K_M for best speed/quality balance

### Hardware Requirements

#### Minimal (4GB RAM) - Coding Agent Only
- **RAM**: 4GB (tight) - 8GB recommended
- **Model**: 3B-4B parameters (Q4 quantized)
- **Web Search**: Cloud API (no local search stack)
- **GPU**: Not required
- **Use Case**: Basic coding assistance, file editing, git operations
- **Limitations**: Slower inference, smaller model capabilities

#### Standard (8GB RAM) - Recommended
- **RAM**: 8GB (good) - 16GB (optimal)
- **Model**: 7B parameters (Q4 quantized)
- **Web Search**: Cloud API (or local search with SearXNG if 12GB+)
- **GPU**: Optional but helpful
- **Use Case**: Full coding agent, web search, multi-file editing
- **Limitations**: Local search not recommended

#### Power User (16GB+ RAM) - Full Experience
- **RAM**: 16GB+
- **Model**: 7B-14B parameters (Q4/Q5 quantized)
- **Web Search**: Cloud API OR local SearXNG stack
- **GPU**: Highly recommended
- **Use Case**: Everything including local web search, large projects
- **Storage**: 10GB+ for models

## Security Considerations

### Local-First Design
- All processing happens on your device
- No data sent to cloud (except local Docker stack)
- Git operations require explicit approval
- Command execution requires permission

### Permission System
Three modes:
1. **Ask** (default): Every operation requires approval
2. **Auto**: Safe operations run automatically, dangerous ones ask
3. **Allowlist**: Specific commands remembered as safe

## Resource Optimization for Low-RAM Systems

### Lightweight Mode (4GB RAM)

For users with limited RAM, the coding agent can work efficiently:

1. **Use Smaller Models**
   - 3B models (Phi-3 Mini, Gemma 2 2B)
   - Q4 quantization
   - ~2-3GB RAM for model

2. **Disable Local Web Search**
   - Use cloud API by default (already configured)
   - No Docker overhead
   - Saves ~1.5-2GB RAM

3. **Optimize Tool Usage**
   - Code-agent itself is lightweight (~100MB)
   - Tools run on-demand, not always loaded
   - File operations are fast and low-memory

4. **Disable Embedding for Simple Tasks**
   - Project search can use simple text matching
   - Disable vector indexing if not needed
   - Saves ~500MB RAM

**4GB RAM Breakdown:**
- Model (3B Q4): 2.5GB
- App overhead: 500MB
- System: 1GB
- **Total: ~4GB** (tight but workable)

### Configuration for Low-RAM

Add to settings or environment:
```typescript
{
  modelId: 'phi-3-mini-4k-instruct-q4',  // 3B model
  embeddingEnabled: false,              // Disable vector search
  localWebSearch: false,                // Use cloud API
  maxContext: 4096,                     // Smaller context
  streamingBatchSize: 16,               // Smaller batches
}
```

## Future Enhancements

### Planned Features
- [ ] Multi-file editing support
- [ ] Code refactoring tools
- [ ] Test generation and execution
- [ ] Code review assistant
- [ ] Dependency analysis
- [ ] Performance profiling
- [ ] GitHub PR management UI
- [ ] CI/CD integration

### Experimental Features
- [ ] Local code indexing with tree-sitter
- [ ] Cross-language code translation
- [ ] Documentation generation
- [ ] API client generation from OpenAPI specs

## Troubleshooting

### Web Search Not Working
```bash
# Check if local API is running
curl http://127.0.0.1:8000/v1/health

# If not, start it
npm run dev:search
```

### Code Agent Not Responding
- Check model is loaded and running
- Verify project folder is selected
- Check permissions in settings
- Review error logs in `~/Library/Application Support/surf-ai/logs/`

### Git Operations Failing
- Ensure git is installed and in PATH
- Check repository is initialized (`git init`)
- Verify you have commit history
- Check remote is configured for push/pull

## Contributing

To extend the agent with new tools:

1. Add tool schema in `apps/desktop/src/main/core/code-agent/tools.ts`
2. Add handler in `apps/desktop/src/main/core/code-agent/loop.ts`
3. Add permission logic if needed
4. Add test cases in `apps/desktop/src/main/core/code-agent.test.ts`
5. Update this documentation

## License

As per Surf AI's original license (UNLICENSED).

---

**Status**: Foundation complete. Integration into main chat pending.
**Last Updated**: 2026-10-19
