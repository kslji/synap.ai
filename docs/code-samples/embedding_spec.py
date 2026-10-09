"""
EmbeddingGemma 2 embedding spec shared by the server pipeline and (mirrored in ts/embedding.ts) the desktop.

Same model + same 256-d Matryoshka truncation + same prefixes on both sides, or the app refuses the pack.

Two interchangeable backends:
  * "llama"  (default)  - llama-server with the SAME GGUF the desktop downloads (bit-for-bit same math path).
        llama-server -m embeddinggemma-2-Q8_0.gguf --embeddings --pooling mean -c 2048 -b 2048 -ub 2048 --port 8081
        (llama.cpp >= b11452; older builds fail with "unknown model architecture: 'gemma-embedding2'")
  * "st"  - sentence-transformers >= 6.1.0 on the original weights (GPU batches on Kaggle/Colab). Text-only:
        SentenceTransformer('google/embeddinggemma-2', config_kwargs={'vision_config': None, 'audio_config': None})
        pip install "sentence-transformers>=6.1.0" torch torchvision pillow   (the processor imports torchvision/PIL
        even for text-only use). Use bfloat16 on GPUs that support it, float32 on CPU. NEVER float16 (NaN).
        Measured on 9 Oct 2026: GGUF Q8_0 vs float32 weights -> cosine >= 0.999 on our test texts (see LAST_RUN).

pip install httpx numpy   (+ the "st" extras above if you use that backend)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict

import httpx


@dataclass(frozen=True)
class EmbeddingSpec:
    id: str = "embeddinggemma-2-text@256"
    model: str = "google/embeddinggemma-2"
    file: str = "embeddinggemma-2-Q8_0.gguf"
    native_dim: int = 768
    dim: int = 256
    pooling: str = "mean"
    normalize: bool = True
    query_prefix: str = "task: search result | query: "
    doc_template: str = "title: {title} | text: {text}"

    def manifest(self) -> dict:
        """Exactly what goes into manifest.json["embedding"] (checked by ts/pack-verify.ts)."""
        return asdict(self)


SPEC = EmbeddingSpec()


def format_query(q: str, spec: EmbeddingSpec = SPEC) -> str:
    return spec.query_prefix + q.strip()


def format_doc(title: str | None, text: str, spec: EmbeddingSpec = SPEC) -> str:
    t = " ".join(title.split()) if title and title.strip() else "none"
    return spec.doc_template.replace("{title}", t).replace("{text}", text.strip())


def truncate_normalize(v: list[float], dim: int) -> list[float]:
    """Matryoshka: keep the first `dim` values, then L2-normalise again (slicing breaks unit length)."""
    if len(v) < dim:
        raise ValueError(f"embedding has {len(v)} dims, need {dim}")
    head = v[:dim]
    if any(math.isnan(x) or math.isinf(x) for x in head):
        raise ValueError("embedding contains NaN/Inf - float16 weights? use bf16/f32 or a Q8_0 GGUF")
    n = math.sqrt(sum(x * x for x in head))
    if n == 0:
        raise ValueError("zero embedding")
    return [x / n for x in head]


class LlamaEmbedder:
    def __init__(self, url: str = "http://127.0.0.1:8081/v1/embeddings", spec: EmbeddingSpec = SPEC,
                 api_key: str | None = None):
        self.url, self.spec = url, spec
        self.client = httpx.Client(timeout=300, headers={"Authorization": f"Bearer {api_key}"} if api_key else {})

    def _run(self, inputs: list[str]) -> list[list[float]]:
        r = self.client.post(self.url, json={"input": inputs, "model": "embed", "encoding_format": "float"})
        r.raise_for_status()
        data = sorted(r.json()["data"], key=lambda d: d["index"])
        out = []
        for d in data:
            if len(d["embedding"]) != self.spec.native_dim:
                raise ValueError(f"server returned {len(d['embedding'])} dims; wrong model loaded?")
            out.append(truncate_normalize(d["embedding"], self.spec.dim))
        return out

    def embed_queries(self, queries: list[str]) -> list[list[float]]:
        return self._run([format_query(q, self.spec) for q in queries])

    def embed_docs(self, docs: list[tuple[str | None, str]]) -> list[list[float]]:
        return self._run([format_doc(t, x, self.spec) for t, x in docs])


class STEmbedder:
    """Same spec on the original weights (GPU). Text-only 270M backbone; vision/audio encoders not loaded."""

    def __init__(self, spec: EmbeddingSpec = SPEC, device: str | None = None):
        import torch
        from sentence_transformers import SentenceTransformer
        bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
        self.spec = spec
        self.model = SentenceTransformer(spec.model, device=device,
                                         config_kwargs={"vision_config": None, "audio_config": None},
                                         model_kwargs={"torch_dtype": torch.bfloat16 if bf16 else torch.float32})

    def _run(self, inputs: list[str]) -> list[list[float]]:
        return self.model.encode(inputs, truncate_dim=self.spec.dim, normalize_embeddings=True,
                                 batch_size=32).tolist()

    def embed_queries(self, queries: list[str]) -> list[list[float]]:
        return self._run([format_query(q, self.spec) for q in queries])

    def embed_docs(self, docs: list[tuple[str | None, str]]) -> list[list[float]]:
        return self._run([format_doc(t, x, self.spec) for t, x in docs])
