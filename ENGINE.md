# Chapter-author guide: the MB animation engine

Every chapter of *How a Matmul Kernel Gets Fast* is one static HTML file that includes
`assets/book.css`, `assets/anim.js`, `assets/nav.js`, and an inline `<script>` that builds
its animations. **Read `ch04-kernel-1-naive.html` in full before writing a chapter** — it is
the exemplar for page structure, prose register, and every engine idiom below. Read
`assets/anim.js` too (it is ~700 lines and is the ground truth for the API).

## Page skeleton (copy from ch04)

```html
<!doctype html><html lang="en"><head> … same <head> as ch04 (fonts + assets/book.css) … </head>
<body>
<div class="frame">
<nav class="side"></nav>            <!-- nav.js fills this -->
<main><article>
  <div class="kicker">Chapter N · <em>Part name</em></div>
  <h1>Title</h1>
  <p class="lede">One or two italic sentences.</p>
  <div class="byline">Kernel · <em>name</em> · GFLOP/s · % of cuBLAS · measured by Simon Boehm on an NVIDIA A6000</div>
  … prose, <h2><span class="no">N.1</span>Section</h2>, <pre><code>…</code></pre>, .aside, .key, .ledger …
  <figure class="wide"><div id="a-something"></div><figcaption><b>Figure N.k.</b> …</figcaption></figure>
  <div class="pager"></div>          <!-- nav.js fills this -->
  <div class="colophon">…</div>
</article></main>
</div>
<script src="assets/anim.js"></script>
<script src="assets/nav.js"></script>
<script> (function(){ const K = MB.color; … one IIFE per animation … })(); </script>
</body></html>
```

Prose components available in `book.css`: `.aside` (with `<div class="t">Aside · title</div>`),
`.key` (the one-sentence takeaway box), `.ledger` with `.cell` / `.cell.good` / `.cell.bad`
(`<div class="l">label</div><div class="v">1,056<small>B</small></div><div class="d">detail</div>`),
`table` inside `.tablewrap`, code spans `.k .n .c .f .s .hl` for keyword / number / comment /
function / string / highlight.

## Building an animation

```js
const S = MB.scene('a-id', { w: 900, h: 480, title: 'accessible title' });   // container div id
const tl = S.tl;            // the timeline
// … create primitives (all start visible unless you pass opacity: 0) …
// … build the timeline: tl.step(caption) then tweens …
S.finish();                 // REQUIRED last call: computes duration, wires controls, renders t=0
```

Options: `w,h` viewBox size (default 900×500; the SVG scales to the column width, so design
at 900 wide and keep text ≥ 10px), `hero: true` (no controls/caption, loops silently — cover
page only), `holdEnd` (seconds to hold the last frame before looping, default 1.8),
`loop:false`.

The engine is **time-based**: every property you tween is a pure function of time, so
play / pause / scrub / step-back all work automatically. Consequence: **never mutate the DOM
yourself after `finish()`** and never use `setTimeout`. Express everything as tweens/sets.

### Primitives (all return objects; composite ones expose `.g`, the movable group)

| call | what it draws | notes |
|---|---|---|
| `S.rect({x,y,w,h,rx,fill,stroke,sw,opacity})` | rectangle | returns a Prim |
| `S.circle({cx,cy,r,fill,stroke,opacity,tx,ty})` | circle | |
| `S.line({x1,y1,x2,y2,stroke,sw,dash,arrow,opacity})` | line, `arrow:true` adds a head | |
| `S.arrow({...})` | line with an arrowhead | |
| `S.path({d,stroke,fill,arrow})` | path | `d` is not tweenable |
| `S.text({x,y,text,size,fill,anchor,weight,font,opacity})` | text; `font`: `'sans'` (default) `'mono'` `'serif'`; `anchor`: `start|middle|end` | tween `text` with `tl.set` |
| `S.group({tx,ty,opacity,scale})` | `<g>`; has `.rect() .text() .line() .circle() .path() .matrix() .tile() …` children | move with `tx,ty` |
| `S.matrix({x,y,rows,cols,cell,values,label,labelPos,fill,stroke,sw,valueSize,frame,opacity})` | a grid of cells | see below |
| `S.membox({x,y,w,h,label,sub,labelPos,fill,stroke,rx,labelSize,opacity})` | rounded box for a memory level / unit | `labelPos`: `bottom|top|center|topleft` |
| `S.tile({x,y,rows,cols,cell,gap,fill,stroke,on:(r,c)=>bool,offFill,frameStroke,frameFill,label,opacity})` | a small movable mini-grid (a "packet" of data) | `.cells[]`, pivot is centred so `scale` shrinks toward the middle |
| `S.threads({x,y,n,size,gap,perRow,fill,label,labelPos,opacity})` | row/grid of small squares (threads, lanes, banks) | `.items[]`, `.center(i)` → `[x,y]` |
| `S.counter({x,y,label,value,size,unit,anchor,format,opacity})` | numeric readout | tween `.num` → `{value: 1056}` |
| `S.bar({x,y,w,h,fill,stroke,label,value,format,opacity})` | horizontal bar with value | `bar.grow(tl, width, value, dur, opts)` |
| `S.tape({x,y,n,cell,h,label,opacity})` | 1-D memory tape of n cells | `.cells[]`, `.center(i)` |

Matrix object: `M.cellAt(r,c)`, `M.valAt(r,c)` (text prims, only if `values` given), `M.row(r)`,
`M.col(c)`, `M.block(r0,c0,nr,nc)`, `M.all()`, `M.allVals()`, `M.center(r,c)` → absolute `[x,y]`,
`M.corner(r,c)`, `M.left() .right() .top() .bottom()`, `M.width M.height`, `M.g` (group), `M.label`.

Colours: `MB.color` = `{ink, muted, faint, rule, accent, A, Afill, Adeep, B, Bfill, Bdeep, C, Cfill,
Cdeep, red, redfill, purple, purplefill, gold, goldfill, teal, tealfill, grey, greyfill, grey2fill,
white, dead}`. **Conventions, never break them:** A = blue, B = green, C = orange, wasted /
warning = red, shared memory = purple, registers = gold, FMA lanes / compute = teal, global
memory & caches = grey. Threads are dark grey squares.

Data: `MB.A8, MB.B8, MB.C8` (the shared 8×8 integer example, C8 = A8·B8), `MB.A4/B4/C4`,
`MB.matmul(A,B)`, `MB.intMatrix(rows,cols,seed,lo,hi)` (seeded, deterministic), `MB.rng(seed)`,
`MB.fmt(n)` (thousands separators). Every number shown must be computed from these or from
the storyboard's verified figures. Never invent a value.

### Timeline

```js
tl.step('Caption for this step. <b>bold</b> and <code>code</code> allowed.');   // marks a step at the cursor
tl.to(target, {fill: K.Afill, stroke: K.A, sw: 1.2}, 0.3, {stagger: 0.05});      // tween; advances cursor
tl.to(target, {opacity: 1}, 0.4, {at: '<'});        // start together with the previous tween
tl.to(target, {tx: 100}, 0.5, {at: '<+0.2'});       // 0.2 s after the previous tween's start
tl.to(target, {value: 1056}, 0.6, {at: 3.2, ease: 'linear'});   // absolute time; eases: linear|in|out|inOut(default)
tl.set(target, {text: 'new label'});                // instant, at cursor (or pass a time / '<' as 3rd arg)
tl.move(group, x, y, 0.8, {arc: -40});              // move a group's tx,ty along a curve (arc = bulge, px)
tl.move(group, x, y, 0.8, {via: [cx, cy]});         // …or through an explicit control point
tl.show(target, 0.4); tl.hide(target, 0.4);         // opacity 1 / 0
tl.pulse(target, 1.2, 0.6);                         // scale up and back (needs a pivot; tiles have one)
tl.wait(1.5);                                       // hold (let the reader read)
```

`target` may be a Prim, a composite (matrix/membox/tile/threads/counter/bar — their group
moves), or an array of these (`stagger` spaces the starts).

**Timing gotcha:** `'<'` and `'<+d'` are relative to the start of the *previous call*, and every
call updates that reference. So `items.forEach(it => tl.to(it, {...}, 0.2, {at: '<+0.1'}))`
chains cumulatively (each starts 0.1 s after the one before — fine for a ripple, wrong if you
wanted them all 0.1 s after one common moment). For many things at once, pass the array with
`stagger`; for exact schedules, capture `const t0 = tl.cursor` and pass absolute times
`{at: t0 + …}`, then set `tl.cursor = t0 + total` before continuing. Tweenable props: `x y width height
rx cx cy r x1 y1 x2 y2 opacity stroke-width(sw) font-size(size) fill stroke tx ty scale rot
value`; step-only: `text display class`.

Rhythm that works: one `tl.step()` per idea, 4–8 steps per animation, 1.2–2 s of `tl.wait()`
after each step so the reader can read the caption; total 15–30 s. The caption **is** the
narration: it should say what is on screen and why it matters, in one or two sentences, in the
same register as the prose. Number every quantity the reader is supposed to notice.

### Layout rules

- Design in the 900-wide viewBox. Leave 40 px margins. Text ≥ 10 px; labels 11–13 px; titles 14–15 px.
- Nothing may overlap: check label positions arithmetically (a 13 px label is ~7 px per char wide).
- Matrices ≥ 8×8: use `cell` 6–8 without values. Small worked examples: `cell` 24–28 with values.
- Use `stagger` for anything that happens to many cells; use `move` with an `arc` for anything
  that travels between memories; use counters for every quantity that changes.
- Every animation ends on a state that summarises the point (a ledger line, a comparison bar).

## Testing (required before you report done)

```bash
node tools/smoke.js chNN-your-file.html
```

It runs in about a second, with no browser: a fake DOM executes `assets/anim.js`,
`assets/nav.js` and your inline script, then renders every scene across its whole timeline.
It reports JS errors with line numbers, figure containers that never became a scene, scenes
without `S.finish()`, NaN/undefined attributes, missing captions, and any use of
`setTimeout`. It must print `RESULT: OK`.

Then **look at your frames** — this is how layout problems get caught without a browser:

```bash
node tools/smoke.js chNN-your-file.html --frames /tmp/frames-NN
python3 tools/frames.py /tmp/frames-NN chNN-your-file        # stem without .html
```

This writes one PNG contact sheet per animation to `/tmp/frames-NN/` (`<stem>__<scene-id>.png`),
showing the final frame of every narration step with its caption. Open each PNG with the Read
tool and check: no overlapping text, nothing running past the right edge (x > 860), every
element the caption mentions is visible, counters show the right numbers. Fix and re-render
until every sheet is clean. (Arrows like → may render as boxes in these PNGs; that is the
renderer's font, not a bug.)
