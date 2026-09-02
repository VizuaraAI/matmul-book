# How a Matmul Kernel Gets Fast — an animated book

Fourteen chapters that take one 4,092 × 4,092 matrix multiply from 1.3% of an NVIDIA A6000 to
93.7% of cuBLAS, following Simon Boehm's ten SGEMM kernels. Every mechanism — coalescing,
shared-memory tiling, the barrier, blocktiling, the outer product, occupancy, vectorized loads,
autotuning, warptiling, split-K, double buffering — is shown as a step-by-step animation with
its own narration, and every number on screen is computed in the page.

- Live: https://vizuaraai.github.io/matmul-book/
- Route and measurements: Simon Boehm, *How to Optimize a CUDA Matmul Kernel for cuBLAS-like
  Performance: a Worklog* (https://siboehm.com/articles/22/CUDA-MMM) and the SGEMM_CUDA repository.
- Prequel: *The CUDA Programming Model* (https://vizuaraai.github.io/cuda-programming-model/).

## Layout

```
index.html                 cover + contents
ch01 … ch14 …html          one chapter per page (see assets/nav.js for the list)
assets/anim.js             the SVG timeline engine (≈ 700 lines, no dependencies)
assets/book.css            typography and layout
assets/nav.js              chapter order, top bar, sidebar, pager, cover cards
tools/smoke.js             fake-DOM test: runs every animation across its timeline
tools/frames.py            renders every narration step to PNG contact sheets
ENGINE.md                  how to write a chapter against the engine
```

Static files only; open `index.html` from any web server. To check a chapter:

```
node tools/smoke.js ch04-kernel-1-naive.html --frames /tmp/f && python3 tools/frames.py /tmp/f ch04-kernel-1-naive
```
