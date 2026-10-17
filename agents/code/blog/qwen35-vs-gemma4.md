---
title: "Qwen3.5 vs Gemma 4: which local model should you pick in Synap.surf?"
description: "A plain-language guide to Qwen3.5 (2B, 4B, 9B) and Gemma 4 (E2B, E4B, 12B): what they are, what they're good at, and which one suits your laptop."
date: 2026-10-16
---

# Qwen3.5 vs Gemma 4: which local model should you pick?

**In short:** Qwen3.5 is our default for the Code agent because its small sizes fit almost any laptop and it handles tool use well. Gemma 4 is a strong optional pick, especially the 12B on a laptop with plenty of memory, or if you want audio input.

Synap.surf runs AI models on your own laptop through [llama.cpp](https://github.com/ggml-org/llama.cpp). Nothing goes to a server. That means the model you pick has to fit in your laptop's memory. This post explains the two model families in the picker so you can choose without guesswork.

A note on numbers: anything marked **"our tests"** comes from our own testing in Synap.surf. Everything else links to the model makers' own pages.

---

## Quick pick: which should I choose?

Find your laptop's RAM (memory) in the left column, then the task you care about.

| Laptop RAM | Coding (Code agent) | Everyday chat | Screenshots and images | Multilingual / Hindi |
|---|---|---|---|---|
| **4 GB** | Qwen3.5-2B | Qwen3.5-2B | Qwen3.5-2B | Qwen3.5-2B |
| **8 GB** | Qwen3.5-2B, or Gemma 4 E2B if you want to try it | Qwen3.5-2B or Gemma 4 E2B | Qwen3.5-2B or Gemma 4 E2B | Try both Qwen3.5-2B and Gemma 4 E2B |
| **16 GB** | Qwen3.5-4B | Qwen3.5-4B or Gemma 4 E4B | Qwen3.5-4B or Gemma 4 E4B | Try both Qwen3.5-4B and Gemma 4 E4B |
| **32 GB** | Qwen3.5-9B or Gemma 4 12B | Gemma 4 12B or Qwen3.5-9B | Qwen3.5-9B or Gemma 4 12B | Try both Qwen3.5-9B and Gemma 4 12B |

Why Gemma 4 doesn't appear in the 4 GB row: Google's official 4-bit Gemma 4 E2B file is about 3.35 GB on its own (see sizes below). That leaves too little room on a 4 GB laptop once the operating system and the app take their share.

For Hindi and other languages, we suggest trying both, because neither maker publishes a Hindi-specific score in the model cards we cite here. More on that below.

---

## How much memory each model needs

Our in-app RAM guide is simple: leave room for your operating system and other apps, and keep the model file well under your total RAM.

| Laptop RAM | Comfortable model size (our guide) |
|---|---|
| 4 GB | up to ~2 GB |
| 8 GB | ~3 GB |
| 16 GB | ~4 GB |
| 32 GB | ~8 GB |

Here are the actual download sizes:

| Model | File | Download size | Source |
|---|---|---|---|
| Qwen3.5-2B | Q6_K | 1.57 GB | our tests |
| Qwen3.5-4B | Q6_K | 3.53 GB | our tests |
| Qwen3.5-9B | Q6_K | 7.46 GB | our tests |
| Gemma 4 E2B | Google's official QAT Q4_0 GGUF | 3.35 GB (+0.99 GB optional image file) | [Hugging Face](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/tree/main) |
| Gemma 4 E4B | Google's official QAT Q4_0 GGUF | 5.15 GB (+0.99 GB optional image file) | [Hugging Face](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/tree/main) |
| Gemma 4 12B | Google's official QAT Q4_0 GGUF | 6.98 GB (+0.18 GB optional image file) | [Hugging Face](https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/tree/main) |

A few honest notes:

- **Qwen3.5-2B is light.** In our tests, the Q6_K file peaked at about **1.74 GB of RAM** with the llama.cpp flags `--no-repack -cram 0`, and generated about **18 tokens per second on CPU** alone (our tests). That's fast enough to read along comfortably.
- **Gemma's "E" models are bigger than their names suggest.** Google explains that "E" means *effective* parameters. The E2B and E4B use Per-Layer Embeddings, large lookup tables that make the file bigger than the effective parameter count implies ([Gemma 4 overview](https://ai.google.dev/gemma/docs/core)). The E2B has 2.3B effective parameters but 5.1B including embeddings ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)).
- **Some files sit slightly above our guide.** Gemma 4 E2B (3.35 GB) is a bit over the ~3 GB guide. The Code menu still lists it on an 8 GB laptop. Gemma 4 E4B (5.15 GB) is over the ~4 GB guide, and the menu lists it on a 16 GB laptop. Qwen3.5-4B (3.53 GB) is over the ~3 GB guide, so the Code menu lists it from the 16 GB tier. Close heavy apps, such as browsers with many tabs, when a file is over the guide.
- **Google says the 12B fits in 16 GB.** Google describes Gemma 4 12B as "small enough to run locally with just 16GB of VRAM or unified memory" ([Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/)). On a regular laptop running on CPU, we still recommend 32 GB for room to breathe.
- **Memory grows with long conversations.** File size isn't the whole story. Longer prompts and answers use extra memory on top of the model weights ([Gemma 4 overview](https://ai.google.dev/gemma/docs/core)).

---

## What is Qwen3.5?

Qwen3.5 is an open model family from the Qwen team at Alibaba. The small sizes we offer, **Qwen3.5-9B, 4B and 2B**, were published on Hugging Face on **2 March 2026** ([Qwen GitHub](https://github.com/QwenLM/Qwen3.5)). The first Qwen3.5 release, a much larger model, came out on 16 February 2026 ([Qwen GitHub](https://github.com/QwenLM/Qwen3.5)).

What the model cards say:

- **It can see images.** Each model is a "Causal Language Model with Vision Encoder", so it takes text, images and video as input ([Qwen3.5-9B card](https://huggingface.co/Qwen/Qwen3.5-9B)).
- **201 languages and dialects** are supported, according to Qwen ([Qwen3.5-9B card](https://huggingface.co/Qwen/Qwen3.5-9B)).
- **Long memory for a conversation.** The context length is 262,144 tokens natively ([Qwen3.5-2B card](https://huggingface.co/Qwen/Qwen3.5-2B)). The 4B and 9B can be extended up to 1,010,000 tokens ([Qwen3.5-4B card](https://huggingface.co/Qwen/Qwen3.5-4B), [Qwen3.5-9B card](https://huggingface.co/Qwen/Qwen3.5-9B)). On a laptop, you'll use far less than that, because memory runs out first.
- **Built for tools.** Qwen says Qwen3.5 "excels in tool calling capabilities" ([Qwen3.5-9B card](https://huggingface.co/Qwen/Qwen3.5-9B)). Tool calling is what lets the Code agent read files and run commands.
- **Thinking mode.** The 4B and 9B "think" (reason step by step) by default before answering. The 2B answers directly by default ([Qwen3.5-4B card](https://huggingface.co/Qwen/Qwen3.5-4B), [Qwen3.5-2B card](https://huggingface.co/Qwen/Qwen3.5-2B)).
- **Licence:** Apache 2.0 ([Qwen3.5-2B card](https://huggingface.co/Qwen/Qwen3.5-2B), [4B](https://huggingface.co/Qwen/Qwen3.5-4B), [9B](https://huggingface.co/Qwen/Qwen3.5-9B)).

An honest caveat about the 2B: Qwen says that "in light of its parameter scale", the 2B is intended for "prototyping, task-specific fine-tuning, and other research or development purposes". Qwen also notes that in thinking mode, it is "more prone to entering thinking loops" than the larger Qwen3.5 models ([Qwen3.5-2B card](https://huggingface.co/Qwen/Qwen3.5-2B)). It's great for small, clear tasks. For bigger coding jobs, step up to the 4B or 9B if your laptop allows.

The Qwen team has since released newer families (Qwen3.6 and Qwen3.8) ([Qwen GitHub](https://github.com/QwenLM/Qwen3.5)). This post covers the Qwen3.5 models in our picker.

---

## What is Gemma 4?

Gemma 4 is Google DeepMind's open model family ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)). Google launched it on **2 April 2026** with the E2B, E4B, 26B and 31B sizes ([Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)). The **12B** followed on **3 June 2026** ([Gemma releases](https://ai.google.dev/gemma/docs/releases), [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/)).

We offer the three sizes that suit laptops: **E2B, E4B and 12B**.

What Google's pages say:

- **Text, images and audio in.** All three accept text and images. E2B, E4B and 12B also accept audio, for speech recognition and speech translation ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)). Audio clips can be up to 30 seconds long ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)).
- **Good with screens and documents.** Google lists document and PDF parsing, "screen and UI understanding", chart reading, OCR (including multilingual) and handwriting recognition ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)).
- **Context length:** 128K tokens on E2B and E4B, and 256K tokens on 12B ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)).
- **Languages:** "Out-of-the-box support for 35+ languages, pre-trained on 140+ languages" ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)).
- **Reasoning and tools.** It has configurable thinking modes and native function calling ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)).
- **The 12B is different inside.** Google calls it "Unified". It has no separate image or audio encoder; images and audio go straight into the main model ([Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/)).
- **Licence:** Apache 2.0. This is the first time Gemma has used this licence ([Google Open Source blog](https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html), [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)).
- **Ready-made laptop files.** Google publishes official 4-bit files for llama.cpp, trained with quantization in mind (QAT) so quality holds up better at small sizes ([Gemma 4 overview](https://ai.google.dev/gemma/docs/core)).

---

## Side by side

| | Qwen3.5 (2B, 4B, 9B) | Gemma 4 (E2B, E4B, 12B) |
|---|---|---|
| **Maker** | Qwen team, Alibaba ([GitHub](https://github.com/QwenLM/Qwen3.5)) | Google DeepMind ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)) |
| **Sizes** | 2B, 4B, 9B parameters ([2B](https://huggingface.co/Qwen/Qwen3.5-2B), [4B](https://huggingface.co/Qwen/Qwen3.5-4B), [9B](https://huggingface.co/Qwen/Qwen3.5-9B)) | E2B (2.3B effective), E4B (4.5B effective), 12B (11.95B) ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)) |
| **Released** | 2 March 2026 ([GitHub](https://github.com/QwenLM/Qwen3.5)) | E2B/E4B: 2 April 2026 ([blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)); 12B: 3 June 2026 ([releases](https://ai.google.dev/gemma/docs/releases)) |
| **Licence** | Apache 2.0 ([card](https://huggingface.co/Qwen/Qwen3.5-9B)) | Apache 2.0 ([blog](https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html)) |
| **Context** | 262,144 tokens ([card](https://huggingface.co/Qwen/Qwen3.5-2B)) | 128K (E2B, E4B), 256K (12B) ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)) |
| **Languages** | 201 languages and dialects ([card](https://huggingface.co/Qwen/Qwen3.5-9B)) | 35+ out of the box, pre-trained on 140+ ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)) |
| **Image input** | Yes, plus video ([card](https://huggingface.co/Qwen/Qwen3.5-9B)) | Yes, plus video as frames ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)) |
| **Audio input** | Not listed | Yes, up to 30 seconds ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)) |
| **Smallest laptop file** | 1.57 GB (2B Q6_K, our tests) | 3.35 GB (E2B Q4_0, [HF](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/tree/main)) |
| **Strengths** | Small files, tool calling, long context, many languages | Images, documents and screens; audio; strong 12B; official 4-bit files |

### What the makers' own benchmarks say

Both makers publish benchmark scores for their models. Two scores appear in both sets of model cards. **Treat these with care.** Each company ran its own tests with its own settings, so the numbers are a rough guide, not a head-to-head race.

| Benchmark | Qwen3.5-2B | Qwen3.5-4B | Qwen3.5-9B | Gemma 4 E2B | Gemma 4 E4B | Gemma 4 12B |
|---|---|---|---|---|---|---|
| LiveCodeBench v6 (coding) | not published | 55.8 | 65.6 | 44.0% | 52.0% | 72.0% |
| MMMLU (multilingual knowledge) | 63.1 | 76.1 | 81.2 | 67.4% | 76.6% | 83.4% |

Sources: [Qwen3.5-9B card](https://huggingface.co/Qwen/Qwen3.5-9B) (4B and 9B), [Qwen3.5-2B card](https://huggingface.co/Qwen/Qwen3.5-2B) (2B, thinking mode), [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4).

Roughly, sizes that are close perform similarly. On these two tests, the Gemma 4 12B scores higher than the Qwen3.5-9B, but it's also a bigger model with a bigger file.

---

## When to use which

**Pick Qwen3.5 when:**

- You want the Code agent to work well on an ordinary laptop. The 2B is a 1.57 GB download (our tests).
- You have 4 GB or 8 GB of RAM.
- You work with long files or long sessions. Even the 2B has a 262,144-token context ([card](https://huggingface.co/Qwen/Qwen3.5-2B)).
- You want a model that's built around tool calling ([card](https://huggingface.co/Qwen/Qwen3.5-9B)).

**Pick Gemma 4 when:**

- You have 32 GB of RAM and want the strongest model in our picker on the makers' published numbers. That's the 12B.
- You work a lot with screenshots, scanned documents, charts or handwriting. Google calls these out specifically ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)).
- You want to give the model short audio clips ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)).
- You just prefer how it writes. Style is personal, and switching is easy.

**For Hindi and other Indian languages:** Qwen says it supports 201 languages and dialects. Google says Gemma 4 was pre-trained on 140+ languages, with out-of-the-box support for 35+. Neither model card we cite names Hindi specifically or gives a Hindi-only score. Our honest advice: ask both the same question in Hindi and keep the one whose answers read better to you.

---

## Why Qwen is our Code agent default

We chose Qwen3.5 as the default for the Code agent for practical reasons:

1. **It fits the most laptops.** The 2B is a 1.57 GB download and peaked at about 1.74 GB of RAM in our tests. That works even on 4 GB machines, where Gemma 4's smallest official file (3.35 GB) doesn't fit comfortably.
2. **It's usable on CPU alone.** About 18 tokens per second on CPU for the 2B (our tests). No graphics card needed.
3. **It's built for tool use.** The Code agent depends on the model calling tools reliably, and Qwen highlights tool calling for Qwen3.5 ([card](https://huggingface.co/Qwen/Qwen3.5-9B)).
4. **It has a clear upgrade path.** If you get more RAM, you can move from 2B to 4B (3.53 GB) to 9B (7.46 GB) within the same family (our tests), with the same behaviour and prompts.
5. **Permissive licence.** Apache 2.0 ([card](https://huggingface.co/Qwen/Qwen3.5-2B)).

Gemma 4 is a fine choice too, and on a 32 GB laptop the 12B is worth trying for coding. That's why it's in the picker as an option.

---

## How to switch models in the app

1. Get the model file from synap.surf. The app looks for that file and keeps it on this computer. Nothing downloads from inside the app.
2. In the sidebar, under **Switch agent**, choose **Code**. That opens a Code chat.
3. **Chat model** is the file already on this computer. **Settings** shows the same name.
4. To read this guide in the app, choose **Which model should I pick?** The same guide is under **Settings**, in the **Code** section, next to **Code model**.

A model already on this computer stays there and is ready the next time you open the app.

If a model fails to load, the chat shows the message from the model server. When a smaller model in the same family exists, the chat also shows **Switch to smaller model**.

---

## FAQ

**Does my code or chat leave my laptop?**
No. Synap.surf runs the model locally with llama.cpp. Your prompts, files and answers stay on your machine.

**Do I need the internet?**
Only to get a model file from the website the first time. After that, both Qwen3.5 and Gemma 4 run fully offline. The app itself does not fetch the file.

**Can I use these models for commercial work?**
Both families are released under the Apache 2.0 licence: Qwen3.5 per its [model cards](https://huggingface.co/Qwen/Qwen3.5-9B), Gemma 4 per [Google](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/), which calls it "commercially permissive". Apache 2.0 generally allows commercial use, modification and redistribution, provided you keep the licence and notices. This isn't legal advice. If it matters for your business, read the licence files on the model pages.

**Which is "better"?**
It depends on your laptop and your task. On a small laptop, Qwen3.5 is the practical choice. On a 32 GB laptop, try both Qwen3.5-9B and Gemma 4 12B and keep the one you like.

**Why is Gemma 4 E2B bigger than Qwen3.5-2B if both are "2B"?**
Gemma's "E2B" counts *effective* parameters. Including its embedding tables, it has 5.1B parameters ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)), so the file is bigger.

**Can these models be wrong?**
Yes. All language models can give confident but wrong answers. Google's model card says plainly that models "may generate incorrect or outdated factual statements" ([model card](https://ai.google.dev/gemma/docs/core/model_card_4)). Review code before you run it.

---

## Sources

**Qwen (Alibaba)**
- Qwen3.5-2B model card: https://huggingface.co/Qwen/Qwen3.5-2B
- Qwen3.5-4B model card: https://huggingface.co/Qwen/Qwen3.5-4B
- Qwen3.5-9B model card: https://huggingface.co/Qwen/Qwen3.5-9B
- Qwen3.5 GitHub repository (release news): https://github.com/QwenLM/Qwen3.5
- Qwen3.5 blog post: https://qwen.ai/blog?id=qwen3.5

**Gemma 4 (Google)**
- Gemma 4 model overview: https://ai.google.dev/gemma/docs/core
- Gemma 4 model card: https://ai.google.dev/gemma/docs/core/model_card_4
- Gemma releases: https://ai.google.dev/gemma/docs/releases
- "Gemma 4: Byte for byte, the most capable open models" (Google blog, 2 April 2026): https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/
- "Introducing Gemma 4 12B" (Google blog, 3 June 2026): https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/
- "Gemma 4: Expanding the Gemmaverse with Apache 2.0" (Google Open Source blog): https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html
- Gemma 4 E2B official QAT Q4_0 GGUF files: https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/tree/main
- Gemma 4 E4B official QAT Q4_0 GGUF files: https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/tree/main
- Gemma 4 12B official QAT Q4_0 GGUF files: https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/tree/main

**Other**
- llama.cpp: https://github.com/ggml-org/llama.cpp
- Synap.surf in-app figures (download sizes for Qwen3.5 Q6_K files, RAM peak, tokens per second, RAM guide): our tests.
