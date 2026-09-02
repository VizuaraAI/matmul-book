/* Chapter list + navigation chrome for the book. One source of truth for order. */
(function () {
  const MB = (window.MB = window.MB || {});
  MB.chapters = [
    { file: 'index.html', num: '', title: 'Cover & contents', short: 'Cover', group: '' },
    { file: 'ch01-the-problem.html', num: '1', title: 'The problem: one matrix multiply, 137 billion operations', short: 'The problem', group: 'Foundations',
      sum: 'What a matrix multiply is, cell by cell; what a FLOP is; why 4,092 × 4,092 means 137 GFLOP; what cuBLAS is and the scoreboard we are climbing.' },
    { file: 'ch02-two-clocks.html', num: '2', title: 'Two clocks: compute-bound or memory-bound', short: 'Two clocks', group: 'Foundations',
      sum: 'The arithmetic clock says 4.6 ms. The memory clock says 0.35 ms. Matmul should be compute-bound by 13×, so why does the first kernel take 445 ms?' },
    { file: 'ch03-the-machine.html', num: '3', title: 'The machine a kernel sees: threads, warps, and three memories', short: 'The machine', group: 'Foundations',
      sum: 'Threads, blocks and warps; registers, shared memory and global memory; row-major layout and the 32-byte sector. Everything the ten kernels will lean on.' },
    { file: 'ch04-kernel-1-naive.html', num: '4', title: 'Kernel 1: the naive version', short: 'Kernel 1 · naive', group: 'The memory-starved kernels', pct: '1.3%',
      sum: 'One thread per output. Watch one thread, then one warp, then the 1,056 bytes that move for every 64 FLOPs.' },
    { file: 'ch05-kernel-2-coalescing.html', num: '5', title: 'Kernel 2: memory coalescing', short: 'Kernel 2 · coalescing', group: 'The memory-starved kernels', pct: '8.5%',
      sum: 'Two index lines change, nothing else does, and the kernel goes 6.4× faster. Coalescing is a property your addresses either have or lack.' },
    { file: 'ch06-kernel-3-shared-memory.html', num: '6', title: 'Kernel 3: caching a tile in shared memory', short: 'Kernel 3 · shared memory', group: 'The memory-starved kernels', pct: '12.8%',
      sum: 'Every value was being fetched 32 times. Fetch it once into a scratchpad the whole block can read, with a barrier so nobody reads too early.' },
    { file: 'ch07-the-bottleneck-moved.html', num: '7', title: 'Why kernel 3 disappointed: the bottleneck moved', short: 'The bottleneck moved', group: 'The memory-starved kernels',
      sum: 'A 32× cut in memory traffic bought 1.5×. Instruction issue and shared-memory bandwidth are the new limit, and loads-per-FMA becomes the number to watch.' },
    { file: 'ch08-kernel-4-1d-blocktiling.html', num: '8', title: 'Kernel 4: 1D blocktiling', short: 'Kernel 4 · 1D blocktiling', group: 'The instruction-starved kernels', pct: '36.5%',
      sum: 'Give each thread eight outputs in a column and one B value serves all eight. Nine loads for eight FMAs.' },
    { file: 'ch09-kernel-5-2d-blocktiling.html', num: '9', title: 'Kernel 5: 2D blocktiling and the outer product', short: 'Kernel 5 · 2D blocktiling', group: 'The instruction-starved kernels', pct: '68.7%',
      sum: 'An 8 × 8 patch per thread: sixteen numbers in registers become sixty-four multiply-adds. The one picture to keep from the whole book.' },
    { file: 'ch10-occupancy.html', num: '10', title: 'Occupancy: the packing game, and why it is not the goal', short: 'Occupancy', group: 'The instruction-starved kernels',
      sum: 'Kernel 5 has lower occupancy than kernel 3 and is five times faster. Threads, registers and shared memory as three budgets, and ILP versus TLP.' },
    { file: 'ch11-kernel-6-vectorized.html', num: '11', title: 'Kernel 6: vectorized memory access', short: 'Kernel 6 · vectorized', group: 'The last mile', pct: '78.4%',
      sum: 'Four 32-bit loads become one 128-bit load, and a transposed shared-memory tile makes that legal for A as well.' },
    { file: 'ch12-kernel-9-autotuning.html', num: '12', title: 'Kernel 9: autotuning (and the bank conflicts of kernels 7 and 8)', short: 'Kernel 9 · autotuning', group: 'The last mile', pct: '84.8%',
      sum: 'Five tile parameters, about 400 legal shapes, one winner per chip. Plus what a shared-memory bank conflict is and why fixing it did not help.' },
    { file: 'ch13-kernel-10-warptiling.html', num: '13', title: 'Kernel 10: warptiling', short: 'Kernel 10 · warptiling', group: 'The last mile', pct: '93.7%',
      sum: 'Block tile, warp tile, thread tile: making the warp an explicit level of the hierarchy, and what that does to registers and shared-memory banks.' },
    { file: 'ch14-cublas-and-the-ladder.html', num: '14', title: 'cuBLAS, the last 6%, and the whole ladder in one view', short: 'cuBLAS & the ladder', group: 'The last mile', pct: '100%',
      sum: 'Many kernels, split-K, double buffering: what a library does that a single kernel cannot. Then the ten kernels on one chart, with the three regimes marked.' },
  ];
  const here = (location.pathname.split('/').pop() || 'index.html');
  const idx = Math.max(0, MB.chapters.findIndex(c => c.file === here));
  const cur = MB.chapters[idx], prev = MB.chapters[idx - 1], next = MB.chapters[idx + 1];
  MB.current = cur;

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // top bar
  const top = document.createElement('div'); top.className = 'topbar';
  top.innerHTML = `<div class="in">
    <a class="brand" href="index.html">How a Matmul Kernel Gets Fast <span>· an animated book</span></a>
    <div class="where">${cur.num ? 'Chapter ' + cur.num + ' of ' + (MB.chapters.length - 1) + ' · ' + esc(cur.short) : 'Cover'}</div>
    ${prev ? `<a class="navbtn" href="${prev.file}" title="${esc(prev.title)}">← Prev</a>` : `<span class="navbtn disabled">← Prev</span>`}
    ${next ? `<a class="navbtn" href="${next.file}" title="${esc(next.title)}">Next →</a>` : `<span class="navbtn disabled">Next →</span>`}
  </div>`;
  document.body.prepend(top);

  // sidebar (filled into <nav class="side"> if the page has one)
  const side = document.querySelector('nav.side');
  if (side) {
    let html = `<div class="t">Contents</div><ol>`;
    let g = null;
    MB.chapters.forEach(c => {
      if (c.group && c.group !== g) { g = c.group; html += `</ol><div class="grp">${esc(g)}</div><ol>`; }
      html += `<li><a href="${c.file}" class="${c.file === here ? 'cur' : ''}"><span class="n">${c.num || '·'}</span><span>${esc(c.short)}${c.pct ? ` <span class="n" style="min-width:0">${c.pct}</span>` : ''}</span></a></li>`;
    });
    html += `</ol>`;
    side.innerHTML = html;
  }

  // footer pager (filled into <div class="pager">)
  const pager = document.querySelector('.pager');
  if (pager) {
    pager.innerHTML =
      (prev ? `<a class="prev" href="${prev.file}"><div class="dir">← Previous</div><div class="ttl">${prev.num ? prev.num + '. ' : ''}${esc(prev.title)}</div></a>` : `<div class="empty"></div>`) +
      (next ? `<a class="next" href="${next.file}"><div class="dir">Next →</div><div class="ttl">${next.num ? next.num + '. ' : ''}${esc(next.title)}</div></a>` : `<div class="empty"></div>`);
  }

  // cover: chapter cards (filled into <div class="cover-grid">)
  const grid = document.querySelector('.cover-grid');
  if (grid) {
    let html = '', g = null;
    MB.chapters.slice(1).forEach(c => {
      if (c.group !== g) { g = c.group; html += `<div class="chap part"><div class="n">Part · ${esc(g)}</div></div>`; }
      html += `<a class="chap" href="${c.file}"><div class="n">Chapter ${c.num}</div>${c.pct ? `<div class="pct">${c.pct}</div>` : ''}<div class="ttl">${esc(c.title)}</div><div class="sum">${esc(c.sum || '')}</div></a>`;
    });
    grid.innerHTML = html;
  }

  // keyboard: [ and ] for prev/next chapter
  document.addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === ']' && next) location.href = next.file;
    if (e.key === '[' && prev) location.href = prev.file;
  });
})();
