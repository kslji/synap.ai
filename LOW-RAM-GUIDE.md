# Surf AI Low-RAM Configuration Guide

## Overview

This guide helps configure Surf AI for optimal performance on systems with limited RAM (4GB-8GB).

## Recommended Models by RAM Capacity

### 4GB RAM - Minimal Configuration

**Model Choice:**
- **Phi-3 Mini (3.8B, Q4_K_M)** - ~2.3GB
- **Gemma 2 2B (Q4_K_M)** - ~1.5GB
- **Qwen 2.5 3B (Q4_K_M)** - ~2.0GB

**Configuration:**
```json
{
  "chatModelId": "phi-3-mini-4k-instruct-q4",
  "embeddingEnabled": false,
  "localWebSearch": false,
  "maxContextTokens": 4096,
  "streamingBatchSize": 16
}
```

**Expected Performance:**
- RAM usage: ~3.5-4GB
- Speed: Slower but usable
- Capabilities: Basic coding, file editing, git operations
- Limitations: No project search, no local web search

### 8GB RAM - Standard Configuration

**Model Choice:**
- **Llama 3.1 8B (Q4_K_M)** - ~4.7GB
- **Qwen 2.5 7B (Q4_K_M)** - ~4.3GB
- **Mistral 7B (Q4_K_M)** - ~4.2GB

**Configuration:**
```json
{
  "chatModelId": "llama-3.1-8b-instruct-q4",
  "embeddingEnabled": true,
  "localWebSearch": false,
  "maxContextTokens": 8192,
  "streamingBatchSize": 32
}
```

**Expected Performance:**
- RAM usage: ~6-7GB
- Speed: Good
- Capabilities: Full coding agent, project search, web search (cloud)
- Limitations: No local web search stack

### 16GB+ RAM - Power User Configuration

**Model Choice:**
- **Llama 3.1 8B (Q5_K_M)** - ~5.5GB
- **Qwen 2.5 14B (Q4_K_M)** - ~8.5GB
- **CodeLlama 13B (Q4_K_M)** - ~7.8GB

**Configuration:**
```json
{
  "chatModelId": "llama-3.1-8b-instruct-q5",
  "embeddingEnabled": true,
  "localWebSearch": true,
  "localWebSearchUrl": "http://127.0.0.1:8000",
  "maxContextTokens": 16384,
  "streamingBatchSize": 64
}
```

**Expected Performance:**
- RAM usage: ~10-12GB
- Speed: Fast with GPU, acceptable without
- Capabilities: Everything including local web search
- Limitations: None

## Optimization Strategies

### 1. Disable Unused Features

**Disable Embedding/Vector Search:**
```typescript
// In app-services.ts or settings
const ENABLE_EMBEDDING = false
```
Saves: ~500MB RAM

**Disable Web Search Caching:**
```typescript
const WEB_CACHE_ENABLED = false
```
Saves: ~200-500MB RAM

**Disable Document Ingestion:**
```typescript
const DOCUMENT_INGESTION_ENABLED = false
```
Saves: ~300MB RAM

### 2. Reduce Context Window

Smaller context = less RAM during inference:
```typescript
// Default: 16384 tokens
// Low-RAM: 4096 tokens
const MAX_CONTEXT_TOKENS = 4096
```
Saves: ~1-2GB RAM during peak usage

### 3. Optimize Streaming

Smaller batches = smoother streaming on low RAM:
```typescript
// Default: 48 tokens per batch
// Low-RAM: 16 tokens per batch
const STREAMING_BATCH_SIZE = 16
```
Improves: Smoothness, perceived performance

### 4. Use Smaller Models

Model size hierarchy (Q4 quantized):
```
2B models:  ~1.5GB RAM (very fast, limited capability)
3B models:  ~2.3GB RAM (fast, basic coding)
7B models:  ~4.5GB RAM (good, full coding)
14B models: ~8.5GB RAM (slow, advanced coding)
```

### 5. Close Other Applications

On 4GB systems, close:
- Web browsers (Chrome: 500MB-2GB per tab)
- IDEs (VS Code: 500MB-1GB)
- Other Electron apps

Recommended: Only Surf AI + minimal tools open

## Performance Tuning

### Monitor RAM Usage

**macOS:**
```bash
# Check memory pressure
top -o mem

# Monitor Surf AI process
ps aux | grep -i surf
```

**Linux:**
```bash
# Check memory
free -h

# Monitor process
htop
```

**Windows:**
```cmd
taskmgr
```

### Adjust Model Quantization

**Q4_K_M (Default):** Best balance of speed/quality
**Q4_K_S:** Slightly smaller, slightly lower quality
**Q3_K_M:** Much smaller (~30% less RAM), much lower quality
**Q5_K_M:** Slightly larger (~15% more RAM), better quality

Example for 4GB RAM:
```json
{
  "modelId": "phi-3-mini-4k-instruct-q3"  // Use Q3 instead of Q4
}
```

### Enable Swap (Linux/macOS)

If you have SSD space, enable swap for safety:

**macOS:**
```bash
# Check current swap
sysctl vm.swapusage

# Add swap (careful!)
sudo dd if=/dev/zero of=/private/var/vm/swapfile bs=1g count=4
sudo chmod 600 /private/var/vm/swapfile
sudo mkswap /private/var/vm/swapfile
sudo swapon /private/var/vm/swapfile
```

**Linux:**
```bash
# Create swap file
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## Troubleshooting Low-RAM Issues

### App Crashes on Startup

**Symptoms:** Surf AI closes immediately

**Causes:**
- Model too large for available RAM
- System too low on memory

**Solutions:**
1. Use smaller model (3B instead of 7B)
2. Close other applications
3. Increase system swap
4. Disable embedding and caching

### Very Slow Inference

**Symptoms:** Response takes 30+ seconds

**Causes:**
- System swapping to disk
- Model too large
- CPU throttling

**Solutions:**
1. Use smaller model
2. Check CPU temperature (may be throttling)
3. Disable background processes
4. Reduce context window

### "Out of Memory" Errors

**Symptoms:** Error messages about memory

**Causes:**
- Model + embeddings + cache exceed RAM

**Solutions:**
1. Disable embeddings
2. Clear web cache
3. Reduce context window
4. Use Q3 quantization
5. Add system swap

## Recommended Starting Points

### For 4GB RAM Laptop

**Step 1:** Download Phi-3 Mini 3B Q4
**Step 2:** Disable all optional features
**Step 3:** Set context to 4096 tokens
**Step 4:** Test basic coding tasks
**Step 5:** If it works, try enabling embeddings

### For 8GB RAM Desktop

**Step 1:** Download Llama 3.1 8B Q4
**Step 2:** Enable embeddings
**Step 3:** Set context to 8192 tokens
**Step 4:** Test full coding agent
**Step 5:** If smooth, try 16K context

### For 16GB+ RAM Workstation

**Step 1:** Download Llama 3.1 8B Q5
**Step 2:** Enable all features
**Step 3:** Set context to 16384 tokens
**Step 4:** Optionally add local web search
**Step 5:** Enjoy full experience

## Benchmark Data

**Expected Response Times (simple coding question):**

| RAM | Model | Quantization | Response Time |
|-----|-------|--------------|---------------|
| 4GB | 3B    | Q4_K_M       | 8-15 seconds  |
| 4GB | 3B    | Q3_K_M       | 6-12 seconds  |
| 8GB | 7B    | Q4_K_M       | 5-10 seconds  |
| 8GB | 7B    | Q5_K_M       | 7-12 seconds  |
| 16GB| 7B    | Q5_K_M       | 3-6 seconds   |
| 16GB| 14B   | Q4_K_M       | 8-15 seconds  |

*Times with CPU only. GPU reduces by 50-70%.*

## Conclusion

Surf AI's coding agent can work efficiently on 4GB RAM systems with proper configuration:

✅ **Coding capabilities** work on 4GB RAM (with 3B model)
✅ **Git operations** are lightweight (no model required)
✅ **File operations** are fast (text processing only)
✅ **Web search** uses cloud API (no local overhead)

❌ **Local web search** requires 12GB+ RAM (SearXNG + FastAPI)
❌ **Large models** (14B+) require 16GB+ RAM
❌ **Vector search** requires 8GB+ RAM for good performance

**Key Insight:** The agentic coding features are lightweight; only the model and search stack consume significant RAM. By using cloud web search and appropriately sized models, Surf AI can serve users across a wide range of hardware configurations.
