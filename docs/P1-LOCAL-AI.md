# P1 — Local AI implementation and evaluation

Status: implementation and technical verification are available. Academic reliability and the latency target are not fully achieved. The P2 implementation is available for evaluation; it must not be described as academically reliable based on technical tests.

## Current evidence

- Baseline and candidate each completed 40 real requests (36 primary conditions and four repeats) on isolated database/PDF copies. Original gold/rubric were retained. Manual coding-agent reviews and reasons are under the respective `reviews.json`; there is no independent teacher review.
- Qwen3.5 4B was downloaded with explicit user permission. Comparison artifacts are under `data/evaluations/p1-qwen35-comparison/`, baseline under `data/evaluations/p1-current-baseline/`, using the original suite, context size 8192 and timeout 180000 ms. No default model or environment file was changed.
- The evaluator now accepts `--chat-model` for local-only model comparisons without changing the running application. The selected model is recorded in the runner manifest and checked on resume.
- Citation validation now rejects any unknown source ID, including mixed valid/invalid lists. General and insufficient answers cannot carry citations. This verifies source membership, not whether each statement is supported by the text.
- The final Student regression run passed 66/66 tests. Targeted citation/evaluator tests also passed. These fixture tests are not real-model quality evidence. Production build, TypeScript check and the initial assistant browser fixture scenario passed.

## Model decision

| Metric (36 primary conditions; repeats excluded) | qwen3:4b | qwen3.5:4b |
| --- | ---: | ---: |
| Correctness 2/2 | 12 | 17 |
| Correctness 1/2 | 7 | 6 |
| Correctness 0/2 | 17 | 13 |
| Median total time | 10.64 s | 17.33 s |
| Total time under 30 s | 33/36 | 22/36 |
| HTTP errors | 1 | 1 |

Keep **qwen3:4b** as the existing default for now. The candidate fixes T06 and the paging/segmentation table, but still gives wrong LRU faults, Round Robin schedules and race-condition outcomes. It failed the materials-mode address calculation while succeeding on the expanded-mode version. It cannot be promoted as a reliable academic upgrade solely on the higher aggregate score.

Timing limitations: candidate execution overlapped production build/regression tasks for part of the run, so these are observed timings, not controlled hardware benchmarks. Cold first response was about 71.9 seconds. Some difficult responses exceeded a minute (one about 172.9 seconds). Do not claim the 15–30 second target has been met. Hardware verification found Ryzen 5 6600H, about 16 GB RAM and RTX 3050 Laptop approximately 4 GB VRAM; Ollama reported 0.40.16.

The source corpus/index differs from old B1 and the current code differs from its commit. This comparison is against the newly measured baseline; old B1 percentages must not be presented as directly interchangeable.

## Pipeline changes

- Unknown citations, including mixed valid/fabricated IDs, are rejected. No synthetic first-source citation is inserted.
- A targeted page is used without semantic padding from unrelated pages. A selected document constrains semantic retrieval. Page-only questions with multiple PDFs ask for a document.
- Echo/invalid-mode guard messages identify a model limitation rather than asserting missing source information.
- Course and general assistant generation share the context builder, providers and final citation/mode validation boundary.
- Local status now distinguishes installed models from an inference response received by this server session. That response timestamp does not guarantee academic correctness.

## Limitations and remaining work

The ten additional questions were authored **after implementation began**. They are extra regression coverage, not a pre-optimization holdout. The suite includes code, arithmetic, elementary Japanese, missing inputs and injection; its hash is stored with the private suite. It must not be used to claim independent generalization. A future teacher-verified locked holdout remains desirable.

Both models completed all ten additional questions on the revised pipeline. Manual ratings: qwen3:4b had 2 full, 3 partial and 5 zero; qwen3.5:4b had 5 full, 3 partial and 2 zero. The candidate answered the array-sum, binary-search, Japanese student reading and injection questions, but still calculated simple duration and page-offset examples incorrectly. This is why no model replacement is automatically applied. All 100 evaluation responses are retained; no best-of rerun selection was used.

An additional real local assistant request used no course sources and returned a 5+10+10+5 minute study suggestion, with `basis=general`, no citations and `isMock=false`. It is a functional inference smoke test on isolated storage, not a reliability benchmark. Artifact: `data/evaluations/p2-real-local-smoke.json`.

The comparison process loaded the pipeline before the stricter citation change. Its results therefore compare models on that earlier pipeline and do not validate the new citation behavior. A final regression run is required after choosing changes. Preserve original manifests and results.

P2 has been implemented because the user explicitly requested both phases to be carried out. Its technical scope and QA are documented in `P2-STUDY-ASSISTANT.md`. P1 academic reliability is still limited; enabling a general assistant does not resolve the model's arithmetic, algorithmic or source-attribution errors.
