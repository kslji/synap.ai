"""
Step 2: clean + filter + dedup the fetched WARC records with HuggingFace datatrove.
Runs on the GCP VM (or a laptop) with LocalPipelineExecutor (no Slurm needed at our scale).

pip install "datatrove[processing]"   # trafilatura, fasttext (LanguageFilter), nltk, ...
Input : data/warc/<niche>/*.warc.gz           (from cc_fetch.py / scraper)
Output: data/clean/<niche>/<crawl>/*.jsonl.gz   (one JSON doc per line: text, id, metadata)
"""
from __future__ import annotations

import os
from urllib.parse import urlparse

from datatrove.data import DocumentsPipeline
from datatrove.executor import LocalPipelineExecutor
from datatrove.pipeline.dedup import MinhashDedupSignature
from datatrove.pipeline.dedup.minhash import (MinhashConfig, MinhashDedupBuckets,
                                              MinhashDedupCluster, MinhashDedupFilter)
from datatrove.pipeline.extractors import Trafilatura
from datatrove.pipeline.filters import (GopherQualityFilter, GopherRepetitionFilter,
                                        LanguageFilter)
from datatrove.pipeline.readers import JsonlReader, WarcReader
from datatrove.pipeline.writers.jsonl import JsonlWriter
from datatrove.utils.hashing import HashConfig

NICHE = os.environ.get("NICHE", "marine")
CRAWL = os.environ.get("CRAWL", "CC-MAIN-2026-39")
USE_LANG_FILTER = os.environ.get("LANG_FILTER", "1") == "1"   # needs fasttext wheel
BASE = f"data/{NICHE}/{CRAWL}"


def tag_documents(data: DocumentsPipeline, rank: int = 0, world_size: int = 1) -> DocumentsPipeline:
    """Custom step: add the fields our Universal Table needs."""
    for doc in data:
        url = doc.metadata.get("url", "")
        doc.metadata["domain"] = urlparse(url).netloc.lower().removeprefix("www.")
        doc.metadata["niche"] = os.environ.get("NICHE", "marine")
        doc.metadata["crawl_id"] = os.environ.get("CRAWL", "")
        doc.metadata["chars"] = len(doc.text)
        yield doc


steps = [
    WarcReader(f"data/warc/{NICHE}", glob_pattern="*.warc.gz",
               default_metadata={"crawl": CRAWL, "niche": NICHE}),
    Trafilatura(favour_precision=True, timeout=5.0),       # HTML -> main text
]
if USE_LANG_FILTER:
    steps.append(LanguageFilter(languages=["en"], language_threshold=0.65))
steps += [
    GopherRepetitionFilter(exclusion_writer=JsonlWriter(f"{BASE}/removed/repetition")),
    GopherQualityFilter(min_doc_words=50,                 # short notices are OK for niche sites
                        exclusion_writer=JsonlWriter(f"{BASE}/removed/quality")),
    tag_documents,
    JsonlWriter(f"{BASE}/filtered"),
]

clean = LocalPipelineExecutor(pipeline=steps, tasks=1, workers=1,
                              logging_dir=f"{BASE}/logs/clean")

# ---- near-duplicate removal (MinHash LSH), same 4-stage recipe as datatrove's example ----
# sha1 as in datatrove's FineWeb recipe (the xxhash default failed with the xxhash version we tested)
mh_cfg = MinhashConfig(hash_config=HashConfig(hash_fc="sha1", precision=64),
                       num_buckets=14, hashes_per_bucket=8, n_grams=5)
MH = f"{BASE}/minhash"
TASKS = 1   # stage-1 and stage-4 task counts MUST match

mh1 = LocalPipelineExecutor(pipeline=[JsonlReader(f"{BASE}/filtered"),
                                      MinhashDedupSignature(output_folder=f"{MH}/sigs", config=mh_cfg)],
                            tasks=TASKS, logging_dir=f"{BASE}/logs/mh1", depends=clean)
mh2 = LocalPipelineExecutor(pipeline=[MinhashDedupBuckets(input_folder=f"{MH}/sigs",
                                                          output_folder=f"{MH}/buckets", config=mh_cfg)],
                            tasks=mh_cfg.num_buckets, logging_dir=f"{BASE}/logs/mh2", depends=mh1)
mh3 = LocalPipelineExecutor(pipeline=[MinhashDedupCluster(input_folder=f"{MH}/buckets",
                                                          output_folder=f"{MH}/remove_ids", config=mh_cfg)],
                            tasks=1, logging_dir=f"{BASE}/logs/mh3", depends=mh2)
mh4 = LocalPipelineExecutor(pipeline=[JsonlReader(f"{BASE}/filtered"),
                                      MinhashDedupFilter(input_folder=f"{MH}/remove_ids"),
                                      JsonlWriter(f"{BASE}/deduped")],
                            tasks=TASKS, logging_dir=f"{BASE}/logs/mh4", depends=mh3)

if __name__ == "__main__":
    mh4.run()   # `depends=` chains: running the last stage runs clean -> mh1 -> mh2 -> mh3 -> mh4
