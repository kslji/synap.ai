"""
Jina code embeddings spec shared by the server pipeline and (mirrored in ts/embedding.ts) the desktop.

Same model + same 256-d Matryoshka truncation + same document template on both sides, or the app refuses the pack.

Two interchangeable backends:
  * "llama"  (default)  - llama-server with the SAME GGUF the desktop downloads (bit-for-bit same math path).
        llama-server -m jina-embeddings-v2-base-code-Q5_K_M.gguf --embeddings --pooling mean -c 2048 -b 2048 -ub 2048 --port 8081
        (llama.cpp >= b11452; older builds fail with "unknown model architecture: 'jina-bert-v2'")
  * "st"  - sentence-transformers on the original weights (GPU batches on Kaggle/Colab).
        SentenceTransformer('jinaai/jina-embeddings-v2-base-code', trust_remote_code=True). Use bfloat16 on GPUs
        that support it, float32 on CPU. NEVER float16 (NaN).
        The model was trained with Matryoshka loss, so the first 256 dims are usable on their own once re-normalised.

pip install httpx numpy   (+ the "st" extras above if you use that backend)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict

import httpx


@dataclass(frozen=True)
class EmbeddingSpec:
    id: str = "jina-embeddings-v2-base-code@256"
    model: str = "jinaai/jina-embeddings-v2-base-code"
    file: str = "jina-embeddings-v2-base-code-Q5_K_M.gguf"
    native_dim: int = 768
    dim: int = 256
    pooling: str = "mean"
    normalize: bool = True
    query_prefix: str = ""
    doc_template: str = "{title}\n{text}"

    def manifest(self) -> dict:
        """Exactly what goes into manifest.json["embedding"] (checked by ts/pack-verify.ts)."""
        return asdict(self)


SPEC = EmbeddingSpec()


def format_query(q: str, spec: EmbeddingSpec = SPEC) -> str:
    return spec.query_prefix + q.strip()


def format_doc(title: str | None, text: str, spec: EmbeddingSpec = SPEC) -> str:
    """Title line first, and only when there is a title: bare text otherwise."""
    head = " ".join(title.split()) if title and title.strip() else ""
    doc = spec.doc_template.replace("{title}", head).replace("{text}", text.strip())
    return doc if head else doc.lstrip("\n")


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
    """Same spec on the original weights (GPU)."""

    def __init__(self, spec: EmbeddingSpec = SPEC, device: str | None = None):
        import torch
        from sentence_transformers import SentenceTransformer
        bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
        self.spec = spec
        self.model = SentenceTransformer(spec.model, device=device, trust_remote_code=True,
                                         model_kwargs={"torch_dtype": torch.bfloat16 if bf16 else torch.float32})

    def _run(self, inputs: list[str]) -> list[list[float]]:
        return self.model.encode(inputs, truncate_dim=self.spec.dim, normalize_embeddings=True,
                                 batch_size=32).tolist()

    def embed_queries(self, queries: list[str]) -> list[list[float]]:
        return self._run([format_query(q, self.spec) for q in queries])

    def embed_docs(self, docs: list[tuple[str | None, str]]) -> list[list[float]]:
        return self._run([format_doc(t, x, self.spec) for t, x in docs])
