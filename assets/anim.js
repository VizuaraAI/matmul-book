/* MB — the tiny SVG animation engine behind "How a Matmul Kernel Gets Fast".
 *
 * Everything animated is a pure function of time. A scene owns an SVG, a set of
 * primitives (rects, text, matrices, memory boxes, packets…) and one timeline of
 * property tracks. Rendering at time t evaluates every track at t and writes the
 * DOM, so play / pause / scrub / step-back are all the same operation. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const MB = (window.MB = window.MB || {});

  // ---------------------------------------------------------------- palette
  MB.color = {
    ink: '#232323', muted: '#6f6a60', faint: '#b9b4a8', rule: '#e6e2d7', paper: '#fdfcf9',
    accent: '#a04c38',
    A: '#2563c9', Afill: '#d6e4fb', Adeep: '#1d4fa3',
    B: '#1f7a45', Bfill: '#d5efdf', Bdeep: '#155c33',
    C: '#d9660c', Cfill: '#fde4cc', Cdeep: '#b3520a',
    red: '#c22f2f', redfill: '#f7d4d4',
    purple: '#6d43b8', purplefill: '#ece6f7',
    gold: '#b8860b', goldfill: '#fbf1d3',
    teal: '#2a7d6f', tealfill: '#d9ece8',
    grey: '#8a8a86', greyfill: '#efefec', grey2fill: '#e4e4e1',
    white: '#ffffff', dead: '#f0ede6',
  };
  const K = MB.color;

  // ---------------------------------------------------------------- utilities
  MB.fmt = function (n, d) {
    if (d === undefined) d = 0;
    const s = Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : (+n).toFixed(d);
    return s;
  };
  MB.rng = function (seed) {           // mulberry32, deterministic across browsers
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  MB.intMatrix = function (rows, cols, seed, lo, hi) {
    const r = MB.rng(seed), M = [];
    for (let i = 0; i < rows; i++) { const row = []; for (let j = 0; j < cols; j++) row.push(lo + Math.floor(r() * (hi - lo + 1))); M.push(row); }
    return M;
  };
  MB.matmul = function (A, B) {
    const n = A.length, k = B.length, m = B[0].length, C = [];
    for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < m; j++) { let s = 0; for (let d = 0; d < k; d++) s += A[i][d] * B[d][j]; row.push(s); } C.push(row); }
    return C;
  };
  // The worked example shared with the companion posts (NumPy, seed 7).
  MB.A8 = [[9,6,7,9,6,7,8,3],[1,3,3,8,9,1,5,8],[2,8,2,5,8,3,4,3],[7,3,9,5,5,5,6,5],[5,9,8,8,7,6,4,9],[5,2,8,2,8,6,2,1],[5,1,2,5,9,5,8,9],[8,6,4,5,3,5,4,3]];
  MB.B8 = [[9,1,1,2,9,7,8,2],[7,4,5,1,6,8,6,2],[5,3,9,8,2,5,9,8],[7,6,1,7,5,1,3,5],[7,5,6,8,7,4,6,6],[1,1,6,4,6,3,3,2],[4,8,4,4,6,9,4,6],[4,6,5,6,5,7,9,2]];
  MB.C8 = MB.matmul(MB.A8, MB.B8);
  MB.A4 = MB.A8.slice(0, 4).map(r => r.slice(0, 4));
  MB.B4 = MB.B8.slice(0, 4).map(r => r.slice(0, 4));
  MB.C4 = MB.matmul(MB.A4, MB.B4);

  const EASE = {
    linear: u => u,
    in: u => u * u * u,
    out: u => 1 - Math.pow(1 - u, 3),
    inOut: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
    step: u => (u >= 1 ? 1 : 0),
  };

  function parseColor(c) {
    if (!c || c === 'none') return null;
    if (c[0] === '#') {
      let h = c.slice(1); if (h.length === 3) h = h.split('').map(x => x + x).join('');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const m = c.match(/rgba?\(([^)]+)\)/); if (m) return m[1].split(',').slice(0, 3).map(Number);
    return null;
  }
  function lerpColor(a, b, u) {
    const A = parseColor(a), B = parseColor(b);
    if (!A || !B) return u < 0.5 ? a : b;
    return 'rgb(' + A.map((x, i) => Math.round(x + (B[i] - x) * u)).join(',') + ')';
  }
  const COLOR_PROPS = { fill: 1, stroke: 1, color: 1 };
  const STEP_PROPS = { text: 1, display: 1, class: 1, d: 1, href: 1, 'text-anchor': 1, 'font-weight': 1 };
  const XFORM_PROPS = { tx: 1, ty: 1, scale: 1, rot: 1 };
  const ALIAS = { w: 'width', h: 'height', sw: 'stroke-width', size: 'font-size', dash: 'stroke-dasharray', dashoffset: 'stroke-dashoffset', anchor: 'text-anchor', weight: 'font-weight' };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------------------------------------------------------------- primitive
  // Every visual thing is a Prim: an SVG node plus a bag of current props. The
  // timeline records tracks per (prim, prop); apply() writes the node.
  class Prim {
    constructor(scene, node, props) {
      this.scene = scene; this.node = node; this.props = {}; this._last = {};
      this._xf = { tx: 0, ty: 0, scale: 1, rot: 0 };
      if (props) this.setNow(props);
    }
    setNow(vars) { for (const k in vars) this.apply(k, vars[k]); }
    apply(prop, v) {
      if (v === undefined) return;
      const p = ALIAS[prop] || prop;
      this.props[p] = v;
      if (this._last[p] === v) return;
      this._last[p] = v;
      if (XFORM_PROPS[p]) {
        this._xf[p] = v;
        const x = this._xf;
        let t = '';
        if (x.tx || x.ty) t += `translate(${r2(x.tx)} ${r2(x.ty)})`;
        if (x.rot) t += ` rotate(${r2(x.rot)})`;
        if (x.scale !== 1) t += ` scale(${r2(x.scale)})`;
        if (this._pivot && (x.rot || x.scale !== 1)) {
          t = `translate(${r2(x.tx)} ${r2(x.ty)}) translate(${this._pivot[0]} ${this._pivot[1]})` +
            (x.rot ? ` rotate(${r2(x.rot)})` : '') + (x.scale !== 1 ? ` scale(${r2(x.scale)})` : '') +
            ` translate(${-this._pivot[0]} ${-this._pivot[1]})`;
        }
        if (t) this.node.setAttribute('transform', t); else this.node.removeAttribute('transform');
      } else if (p === 'text') {
        this.node.textContent = v;
      } else if (p === 'display') {
        if (v === 'none' || v === false) this.node.setAttribute('display', 'none'); else this.node.removeAttribute('display');
      } else if (p === 'class') {
        this.node.setAttribute('class', v);
      } else if (p === 'value') {
        this.node.textContent = this.format ? this.format(v) : MB.fmt(v);
      } else {
        this.node.setAttribute(p, typeof v === 'number' ? r2(v) : v);
      }
    }
    get(prop) {
      const p = ALIAS[prop] || prop;
      if (XFORM_PROPS[p]) return this._xf[p];
      if (this.props[p] !== undefined) return this.props[p];
      const a = this.node.getAttribute(p);
      if (a === null) return p === 'opacity' ? 1 : undefined;
      return (a !== '' && !isNaN(+a)) ? +a : a;
    }
    pivot(x, y) { this._pivot = [x, y]; return this; }
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  // A Group is a Prim whose node is <g>; children are created through it.
  class Group extends Prim {
    constructor(scene, parentNode, props) {
      super(scene, el('g', null, parentNode), props);
    }
    rect(o) { return this.scene._rect(this.node, o); }
    text(o) { return this.scene._text(this.node, o); }
    line(o) { return this.scene._line(this.node, o); }
    circle(o) { return this.scene._circle(this.node, o); }
    path(o) { return this.scene._path(this.node, o); }
    group(o) { return new Group(this.scene, this.node, o); }
    matrix(o) { return this.scene._matrix(this.node, o); }
    membox(o) { return this.scene._membox(this.node, o); }
    arrow(o) { return this.scene._arrow(this.node, o); }
    counter(o) { return this.scene._counter(this.node, o); }
    threads(o) { return this.scene._threads(this.node, o); }
    tile(o) { return this.scene._tile(this.node, o); }
    bar(o) { return this.scene._bar(this.node, o); }
    tape(o) { return this.scene._tape(this.node, o); }
  }

  // ---------------------------------------------------------------- scene
  class Scene {
    constructor(container, opts) {
      opts = opts || {};
      this.w = opts.w || 900; this.h = opts.h || 500;
      this.container = typeof container === 'string' ? document.getElementById(container) : container;
      this.container.classList.add('anim');
      if (opts.hero) this.container.classList.add('anim-hero');
      this.hero = !!opts.hero;
      this.loop = opts.loop !== false;
      this.holdEnd = opts.holdEnd === undefined ? 1.8 : opts.holdEnd;
      this.svg = el('svg', { viewBox: `0 0 ${this.w} ${this.h}`, width: '100%', class: 'anim-svg', role: 'img' }, this.container);
      if (opts.title) el('title', null, this.svg).textContent = opts.title;
      this.defs = el('defs', null, this.svg);
      this._markers = {};
      this.root = el('g', null, this.svg);
      this.prims = [];
      this.tl = new Timeline(this);
      if (!this.hero) this._buildChrome(opts);
      this.t = 0; this.playing = false; this.userPaused = false; this.speed = 1;
      this._raf = null; this._lastTs = 0; this._holdUntil = 0;
      MB.scenes.push(this);
      this._observe();
    }
    // --- factories
    group(o) { return new Group(this, this.root, o); }
    rect(o) { return this._rect(this.root, o); }
    text(o) { return this._text(this.root, o); }
    line(o) { return this._line(this.root, o); }
    circle(o) { return this._circle(this.root, o); }
    path(o) { return this._path(this.root, o); }
    matrix(o) { return this._matrix(this.root, o); }
    membox(o) { return this._membox(this.root, o); }
    arrow(o) { return this._arrow(this.root, o); }
    counter(o) { return this._counter(this.root, o); }
    threads(o) { return this._threads(this.root, o); }
    tile(o) { return this._tile(this.root, o); }
    bar(o) { return this._bar(this.root, o); }
    tape(o) { return this._tape(this.root, o); }

    _reg(p) { this.prims.push(p); return p; }
    _rect(parent, o) {
      o = Object.assign({ rx: 3, fill: K.white, stroke: K.ink, sw: 1 }, o);
      const { x, y, w, h, ...rest } = o;
      return this._reg(new Prim(this, el('rect', { x, y, width: w, height: h }, parent), rest));
    }
    _circle(parent, o) {
      o = Object.assign({ fill: K.ink, stroke: 'none' }, o);
      const { cx, cy, r, ...rest } = o;
      return this._reg(new Prim(this, el('circle', { cx, cy, r }, parent), rest));
    }
    _line(parent, o) {
      o = Object.assign({ stroke: K.ink, sw: 1.2 }, o);
      const { x1, y1, x2, y2, arrow, ...rest } = o;
      const n = el('line', { x1, y1, x2, y2 }, parent);
      if (arrow) n.setAttribute('marker-end', `url(#${this._marker(o.stroke)})`);
      return this._reg(new Prim(this, n, rest));
    }
    _path(parent, o) {
      o = Object.assign({ fill: 'none', stroke: K.ink, sw: 1.2 }, o);
      const { d, arrow, ...rest } = o;
      const n = el('path', { d }, parent);
      if (arrow) n.setAttribute('marker-end', `url(#${this._marker(o.stroke)})`);
      return this._reg(new Prim(this, n, rest));
    }
    _text(parent, o) {
      o = Object.assign({ size: 13, fill: K.ink, anchor: 'start', font: 'sans' }, o);
      const { x, y, text, font, ...rest } = o;
      const n = el('text', { x, y, class: 'f-' + font, 'dominant-baseline': o.baseline || 'middle' }, parent);
      delete rest.baseline;
      n.textContent = text == null ? '' : text;
      const p = new Prim(this, n, rest);
      p.props.text = text;
      return this._reg(p);
    }
    _marker(color) {
      const id = 'arw' + (color || K.ink).replace(/[^a-zA-Z0-9]/g, '');
      if (!this._markers[id]) {
        const m = el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, this.defs);
        el('path', { d: 'M0,0.5 L10,5 L0,9.5 z', fill: color || K.ink }, m);
        this._markers[id] = true;
      }
      return id;
    }
    _arrow(parent, o) { return this._line(parent, Object.assign({ arrow: true, sw: 1.4 }, o)); }

    // A matrix grid. cells[r][c] are rect Prims; vals[r][c] text Prims (if values given).
    _matrix(parent, o) {
      o = Object.assign({ cell: 22, gap: 0, fill: K.white, stroke: '#c9c4bb', sw: 0.7, labelSize: 13, labelPos: 'top', valueSize: null, valueFill: K.ink, rx: 0 }, o);
      const g = new Group(this, parent, { tx: o.x, ty: o.y, opacity: o.opacity === undefined ? 1 : o.opacity });
      const M = { g, rows: o.rows, cols: o.cols, cell: o.cell, gap: o.gap, x: o.x, y: o.y, cells: [], vals: [], opts: o };
      const step = o.cell + o.gap;
      // background frame for crispness
      M.frame = this._reg(new Prim(this, el('rect', { x: -0.5, y: -0.5, width: o.cols * step - o.gap + 1, height: o.rows * step - o.gap + 1 }, g.node), { fill: 'none', stroke: o.frame || 'none', sw: 1.2, rx: 1 }));
      for (let r = 0; r < o.rows; r++) {
        const row = [], vrow = [];
        for (let c = 0; c < o.cols; c++) {
          const rc = this._reg(new Prim(this, el('rect', { x: c * step, y: r * step, width: o.cell, height: o.cell }, g.node), { fill: o.fill, stroke: o.stroke, sw: o.sw, rx: o.rx }));
          rc.r = r; rc.c = c; row.push(rc);
          if (o.values) {
            const v = o.values[r][c];
            const tp = this._reg(new Prim(this, el('text', { x: c * step + o.cell / 2, y: r * step + o.cell / 2 + 0.5, class: 'f-sans', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, g.node), { fill: o.valueFill, size: o.valueSize || Math.max(7, o.cell * 0.46) }));
            tp.node.textContent = v; tp.props.text = v; vrow.push(tp);
          }
        }
        M.cells.push(row); M.vals.push(vrow);
      }
      if (o.label) {
        const lw = o.cols * step - o.gap, lh = o.rows * step - o.gap;
        let lx = lw / 2, ly = -o.labelSize * 0.9, anchor = 'middle';
        if (o.labelPos === 'left') { lx = -8; ly = lh / 2; anchor = 'end'; }
        if (o.labelPos === 'bottom') { ly = lh + o.labelSize * 0.95; }
        if (o.labelPos === 'right') { lx = lw + 8; ly = lh / 2; anchor = 'start'; }
        M.label = this._reg(new Prim(this, el('text', { x: lx, y: ly, class: 'f-sans', 'text-anchor': anchor, 'dominant-baseline': 'middle' }, g.node), { fill: o.labelFill || K.ink, size: o.labelSize, weight: 600 }));
        M.label.node.textContent = o.label; M.label.props.text = o.label;
      }
      M.cellAt = (r, c) => M.cells[r][c];
      M.valAt = (r, c) => M.vals[r] && M.vals[r][c];
      M.row = r => M.cells[r];
      M.col = c => M.cells.map(row => row[c]);
      M.all = () => M.cells.flat();
      M.allVals = () => M.vals.flat();
      M.block = (r0, c0, nr, nc) => { const out = []; for (let r = r0; r < r0 + nr; r++) for (let c = c0; c < c0 + nc; c++) out.push(M.cells[r][c]); return out; };
      // absolute (scene) coordinates of a cell's centre, honouring the group's current translate
      M.center = (r, c) => [g.get('tx') + c * step + o.cell / 2, g.get('ty') + r * step + o.cell / 2];
      M.corner = (r, c) => [g.get('tx') + c * step, g.get('ty') + r * step];
      M.width = o.cols * step - o.gap; M.height = o.rows * step - o.gap;
      M.right = () => g.get('tx') + M.width; M.bottom = () => g.get('ty') + M.height;
      M.left = () => g.get('tx'); M.top = () => g.get('ty');
      return M;
    }
    // A labelled rounded box for a memory level or a unit.
    _membox(parent, o) {
      o = Object.assign({ fill: K.greyfill, stroke: K.grey, sw: 1.2, rx: 10, labelSize: 14, labelPos: 'bottom', labelFill: K.ink }, o);
      const g = new Group(this, parent, { tx: o.x, ty: o.y, opacity: o.opacity === undefined ? 1 : o.opacity });
      const box = this._reg(new Prim(this, el('rect', { x: 0, y: 0, width: o.w, height: o.h }, g.node), { fill: o.fill, stroke: o.stroke, sw: o.sw, rx: o.rx }));
      let label = null, sub = null;
      if (o.label) {
        let lx = o.w / 2, ly = o.h - o.labelSize * 0.95;
        if (o.labelPos === 'top') ly = o.labelSize * 1.0;
        if (o.labelPos === 'center') ly = o.h / 2;
        if (o.labelPos === 'topleft') { lx = 12; ly = o.labelSize * 1.05; }
        label = this._reg(new Prim(this, el('text', { x: lx, y: ly, class: 'f-sans', 'text-anchor': o.labelPos === 'topleft' ? 'start' : 'middle', 'dominant-baseline': 'middle' }, g.node), { fill: o.labelFill, size: o.labelSize, weight: 600 }));
        label.node.textContent = o.label; label.props.text = o.label;
        if (o.sub) {
          sub = this._reg(new Prim(this, el('text', { x: lx, y: ly + o.labelSize * 1.15, class: 'f-sans', 'text-anchor': o.labelPos === 'topleft' ? 'start' : 'middle', 'dominant-baseline': 'middle' }, g.node), { fill: K.muted, size: o.labelSize * 0.8 }));
          sub.node.textContent = o.sub; sub.props.text = o.sub;
        }
      }
      return { g, box, label, sub, x: o.x, y: o.y, w: o.w, h: o.h, cx: o.x + o.w / 2, cy: o.y + o.h / 2, top: o.y, bottom: o.y + o.h, left: o.x, right: o.x + o.w,
        rect: g.rect.bind(g), text: g.text.bind(g), matrix: g.matrix.bind(g), tile: g.tile.bind(g), threads: g.threads.bind(g), line: g.line.bind(g) };
    }
    // A small movable tile (mini matrix) — the "packet" of data that travels between memories.
    _tile(parent, o) {
      o = Object.assign({ rows: 2, cols: 2, cell: 8, gap: 1, fill: K.Afill, stroke: K.A, sw: 0.8, opacity: 1, rx: 1 }, o);
      const g = new Group(this, parent, { tx: o.x, ty: o.y, opacity: o.opacity, scale: o.scale || 1 });
      const step = o.cell + o.gap, cells = [];
      const W = o.cols * step - o.gap, H = o.rows * step - o.gap;
      const frame = this._reg(new Prim(this, el('rect', { x: -2, y: -2, width: W + 4, height: H + 4 }, g.node), { fill: o.frameFill || K.white, stroke: o.frameStroke || 'none', sw: 1, rx: 2, opacity: o.frameFill || o.frameStroke ? 1 : 0 }));
      for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
        const isOn = !o.on || o.on(r, c);
        cells.push(this._reg(new Prim(this, el('rect', { x: c * step, y: r * step, width: o.cell, height: o.cell }, g.node), { fill: isOn ? o.fill : (o.offFill || K.dead), stroke: isOn ? o.stroke : (o.offStroke || K.faint), sw: o.sw, rx: o.rx })));
      }
      let label = null;
      if (o.label) {
        label = this._reg(new Prim(this, el('text', { x: W / 2, y: H + 9, class: 'f-sans', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, g.node), { fill: o.labelFill || o.stroke, size: o.labelSize || 9, weight: 600 }));
        label.node.textContent = o.label; label.props.text = o.label;
      }
      g.pivot(W / 2, H / 2);
      return { g, cells, frame, label, w: W, h: H, cell: o.cell, step };
    }
    // A row of small squares: threads in a warp (or lanes, or banks).
    _threads(parent, o) {
      o = Object.assign({ n: 32, size: 9, gap: 3, fill: '#5b5750', stroke: 'none', rx: 1.5, perRow: 0 }, o);
      const g = new Group(this, parent, { tx: o.x, ty: o.y, opacity: o.opacity === undefined ? 1 : o.opacity });
      const items = [];
      const perRow = o.perRow || o.n;
      for (let i = 0; i < o.n; i++) {
        const cx = (i % perRow) * (o.size + o.gap), cy = Math.floor(i / perRow) * (o.size + o.gap);
        const p = this._reg(new Prim(this, el('rect', { x: cx, y: cy, width: o.size, height: o.size }, g.node), { fill: o.fill, stroke: o.stroke, sw: 0.8, rx: o.rx }));
        p.i = i; items.push(p);
      }
      const W = Math.min(o.n, perRow) * (o.size + o.gap) - o.gap;
      const H = Math.ceil(o.n / perRow) * (o.size + o.gap) - o.gap;
      let label = null;
      if (o.label) {
        const lp = o.labelPos || 'left';
        const lx = lp === 'left' ? -8 : (lp === 'right' ? W + 8 : W / 2);
        const ly = lp === 'top' ? -10 : (lp === 'bottom' ? H + 10 : H / 2);
        label = this._reg(new Prim(this, el('text', { x: lx, y: ly, class: 'f-sans', 'text-anchor': lp === 'left' ? 'end' : (lp === 'right' ? 'start' : 'middle'), 'dominant-baseline': 'middle' }, g.node), { fill: o.labelFill || K.muted, size: o.labelSize || 11 }));
        label.node.textContent = o.label; label.props.text = o.label;
      }
      return { g, items, label, w: W, h: H, size: o.size, gap: o.gap, center: i => [g.get('tx') + (i % perRow) * (o.size + o.gap) + o.size / 2, g.get('ty') + Math.floor(i / perRow) * (o.size + o.gap) + o.size / 2] };
    }
    // A numeric readout whose 'value' prop can be tweened.
    _counter(parent, o) {
      o = Object.assign({ size: 15, fill: K.ink, anchor: 'start', labelSize: 11, labelFill: K.muted, value: 0, format: v => MB.fmt(v) }, o);
      const g = new Group(this, parent, { tx: o.x, ty: o.y, opacity: o.opacity === undefined ? 1 : o.opacity });
      let label = null;
      if (o.label) {
        label = this._reg(new Prim(this, el('text', { x: 0, y: 0, class: 'f-sans', 'text-anchor': o.anchor, 'dominant-baseline': 'middle' }, g.node), { fill: o.labelFill, size: o.labelSize }));
        label.node.textContent = o.label; label.props.text = o.label;
      }
      const num = this._reg(new Prim(this, el('text', { x: 0, y: o.label ? o.labelSize * 1.55 : 0, class: 'f-sans', 'text-anchor': o.anchor, 'dominant-baseline': 'middle' }, g.node), { fill: o.fill, size: o.size, weight: 600 }));
      num.format = o.format; num.apply('value', o.value);
      let unit = null;
      if (o.unit) {
        unit = this._reg(new Prim(this, el('text', { x: 0, y: (o.label ? o.labelSize * 1.55 : 0) + o.size * 0.95, class: 'f-sans', 'text-anchor': o.anchor, 'dominant-baseline': 'middle' }, g.node), { fill: K.muted, size: o.labelSize }));
        unit.node.textContent = o.unit; unit.props.text = o.unit;
      }
      return { g, label, num, unit };
    }
    // A horizontal bar with a value label at its end (for byte bills, ledgers).
    _bar(parent, o) {
      o = Object.assign({ h: 16, fill: K.Afill, stroke: K.A, sw: 1, rx: 2, labelSize: 12, valueSize: 12, w: 0 }, o);
      const g = new Group(this, parent, { tx: o.x, ty: o.y, opacity: o.opacity === undefined ? 1 : o.opacity });
      const rect = this._reg(new Prim(this, el('rect', { x: 0, y: 0, height: o.h }, g.node), { width: o.w, fill: o.fill, stroke: o.stroke, sw: o.sw, rx: o.rx }));
      let label = null, value = null;
      if (o.label) {
        label = this._reg(new Prim(this, el('text', { x: -10, y: o.h / 2 + 0.5, class: 'f-sans', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, g.node), { fill: o.labelFill || K.ink, size: o.labelSize }));
        label.node.textContent = o.label; label.props.text = o.label;
      }
      value = this._reg(new Prim(this, el('text', { x: o.w + 8, y: o.h / 2 + 0.5, class: 'f-sans', 'text-anchor': 'start', 'dominant-baseline': 'middle' }, g.node), { fill: o.valueFill || K.ink, size: o.valueSize, weight: 600 }));
      value.format = o.format || (v => MB.fmt(v));
      value.apply('value', o.value === undefined ? 0 : o.value);
      value.apply('x', o.w + 8);
      const bar = { g, rect, label, value, h: o.h };
      // grow the bar to width w while its readout counts to v
      bar.grow = (tl, w, v, dur, opts) => { tl.to(rect, { width: w }, dur, opts); tl.to(value, { x: w + 8, value: v }, dur, { at: '<', ease: (opts && opts.ease) || 'inOut' }); return tl; };
      return bar;
    }
    // A 1-D memory tape: n consecutive cells (the row-major picture of a matrix).
    _tape(parent, o) {
      o = Object.assign({ n: 32, cell: 14, h: 14, fill: K.white, stroke: '#c9c4bb', sw: 0.7, gap: 0 }, o);
      const g = new Group(this, parent, { tx: o.x, ty: o.y, opacity: o.opacity === undefined ? 1 : o.opacity });
      const cells = [];
      for (let i = 0; i < o.n; i++) {
        const p = this._reg(new Prim(this, el('rect', { x: i * (o.cell + o.gap), y: 0, width: o.cell, height: o.h }, g.node), { fill: o.fill, stroke: o.stroke, sw: o.sw }));
        p.i = i; cells.push(p);
      }
      const W = o.n * (o.cell + o.gap) - o.gap;
      let label = null;
      if (o.label) {
        label = this._reg(new Prim(this, el('text', { x: -8, y: o.h / 2, class: 'f-sans', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, g.node), { fill: K.muted, size: 11 }));
        label.node.textContent = o.label; label.props.text = o.label;
      }
      return { g, cells, label, w: W, h: o.h, cell: o.cell, center: i => [g.get('tx') + i * (o.cell + o.gap) + o.cell / 2, g.get('ty') + o.h / 2], left: i => g.get('tx') + i * (o.cell + o.gap) };
    }

    // --- chrome: controls + caption
    _buildChrome(opts) {
      const bar = document.createElement('div'); bar.className = 'anim-bar';
      bar.innerHTML =
        `<button class="ab-btn ab-play" aria-label="Play or pause" title="Play / pause (space)"></button>` +
        `<button class="ab-btn ab-prev" aria-label="Previous step" title="Previous step (←)"><svg viewBox="0 0 16 16"><path d="M11 3v10L4 8z"/><rect x="2.5" y="3" width="1.6" height="10"/></svg></button>` +
        `<button class="ab-btn ab-next" aria-label="Next step" title="Next step (→)"><svg viewBox="0 0 16 16"><path d="M5 3v10l7-5z"/><rect x="11.9" y="3" width="1.6" height="10"/></svg></button>` +
        `<div class="ab-track"><input type="range" class="ab-range" min="0" max="1" step="0.001" value="0" aria-label="Timeline"><div class="ab-ticks"></div></div>` +
        `<span class="ab-step"></span>` +
        `<button class="ab-btn ab-speed" title="Playback speed">1×</button>`;
      this.container.appendChild(bar);
      const cap = document.createElement('div'); cap.className = 'anim-cap';
      cap.innerHTML = `<span class="ac-no"></span><span class="ac-text"></span>`;
      this.container.appendChild(cap);
      this.ui = {
        play: bar.querySelector('.ab-play'), prev: bar.querySelector('.ab-prev'), next: bar.querySelector('.ab-next'),
        range: bar.querySelector('.ab-range'), ticks: bar.querySelector('.ab-ticks'), step: bar.querySelector('.ab-step'),
        speed: bar.querySelector('.ab-speed'), capNo: cap.querySelector('.ac-no'), capText: cap.querySelector('.ac-text'),
      };
      this.ui.play.addEventListener('click', () => this.toggle(true));
      this.ui.prev.addEventListener('click', () => this.prevStep());
      this.ui.next.addEventListener('click', () => this.nextStep());
      this.ui.range.addEventListener('input', e => { this.pause(true); this.seek(parseFloat(e.target.value)); });
      this.ui.speed.addEventListener('click', () => { this.speed = this.speed === 1 ? 0.5 : (this.speed === 0.5 ? 2 : 1); this.ui.speed.textContent = this.speed + '×'; });
      this.container.tabIndex = 0;
      this.container.addEventListener('keydown', e => {
        if (e.key === ' ') { e.preventDefault(); this.toggle(true); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); this.nextStep(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); this.prevStep(); }
      });
      this._setPlayIcon();
    }
    _setPlayIcon() {
      if (!this.ui) return;
      this.ui.play.innerHTML = this.playing
        ? `<svg viewBox="0 0 16 16"><rect x="3" y="2.5" width="3.6" height="11" rx="0.8"/><rect x="9.4" y="2.5" width="3.6" height="11" rx="0.8"/></svg>`
        : `<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>`;
      this.container.classList.toggle('is-playing', this.playing);
    }
    // Called once the author has finished building the timeline.
    finish() {
      this.duration = this.tl.duration();
      if (this.ui) {
        this.ui.range.max = this.duration.toFixed(3);
        this.ui.ticks.innerHTML = this.tl.steps.map(s => `<i style="left:${(s.t / this.duration * 100).toFixed(2)}%"></i>`).join('');
      }
      this.seek(0);
      return this;
    }
    seek(t) {
      this.t = Math.max(0, Math.min(this.duration || 0, t));
      this.tl.render(this.t);
      if (this.ui) {
        this.ui.range.value = this.t;
        const s = this.tl.stepAt(this.t);
        if (s) {
          this.ui.capNo.textContent = (s.index + 1) + '';
          if (this.ui.capText.innerHTML !== s.caption) this.ui.capText.innerHTML = s.caption;
          this.ui.step.textContent = `${s.index + 1} / ${this.tl.steps.length}`;
        }
      }
    }
    play(user) {
      if (this.playing) return;
      if (user) this.userPaused = false;
      if (this.t >= this.duration - 1e-6) { this.t = 0; }
      this.playing = true; this._lastTs = 0; this._holdUntil = 0;
      this._setPlayIcon();
      const tick = ts => {
        if (!this.playing) return;
        if (this._lastTs) {
          const dt = Math.min(0.1, (ts - this._lastTs) / 1000) * this.speed;
          if (this._holdUntil) {
            if (ts >= this._holdUntil) { this._holdUntil = 0; this.seek(0); }
          } else {
            const nt = this.t + dt;
            if (nt >= this.duration) {
              this.seek(this.duration);
              if (this.loop) this._holdUntil = ts + this.holdEnd * 1000;
              else { this.pause(); return; }
            } else this.seek(nt);
          }
        }
        this._lastTs = ts;
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }
    pause(user) {
      if (user) this.userPaused = true;
      this.playing = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null; this._setPlayIcon();
    }
    toggle(user) { if (this.playing) this.pause(user); else this.play(user); }
    nextStep() {
      const steps = this.tl.steps, cur = this.tl.stepAt(this.t);
      const i = cur ? cur.index : -1;
      this.pause(true);
      if (i + 1 < steps.length) this.seek(steps[i + 1].t); else this.seek(this.duration);
    }
    prevStep() {
      const steps = this.tl.steps, cur = this.tl.stepAt(this.t);
      this.pause(true);
      if (!cur) { this.seek(0); return; }
      if (this.t - cur.t > 0.6 || cur.index === 0) this.seek(cur.t); else this.seek(steps[cur.index - 1].t);
    }
    _observe() {
      if (location.hash === '#selftest') return;   // headless smoke test: never start rAF loops
      if (!('IntersectionObserver' in window)) { this.play(); return; }
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting && e.intersectionRatio >= 0.25) { if (!this.userPaused && !reduce) this.play(); }
          else if (this.playing) this.pause();
        });
      }, { threshold: [0, 0.25, 0.5] });
      io.observe(this.container);
    }
  }

  // ---------------------------------------------------------------- timeline
  class Timeline {
    constructor(scene) {
      this.scene = scene; this.tracks = new Map(); this.steps = []; this.cursor = 0; this._prevStart = 0; this._end = 0;
    }
    duration() { return Math.max(this._end, this.cursor); }
    _track(prim, prop) {
      let m = this.tracks.get(prim); if (!m) { m = new Map(); this.tracks.set(prim, m); }
      let tr = m.get(prop); if (!tr) { tr = { segs: [], init: prim.get(prop) }; m.set(prop, tr); }
      return tr;
    }
    _eval(tr, t) {
      const segs = tr.segs; let v = tr.init;
      // segments are appended in start order; walk to the last one that has begun
      let lo = 0, hi = segs.length - 1, idx = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid].t0 <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
      if (idx < 0) return v;
      const s = segs[idx];
      if (t >= s.t1 || s.t1 === s.t0) return s.v1;
      const u = s.ease((t - s.t0) / (s.t1 - s.t0));
      if (s.curve) return s.curve(u);
      if (typeof s.v0 === 'number' && typeof s.v1 === 'number') return s.v0 + (s.v1 - s.v0) * u;
      if (COLOR_PROPS[s.prop]) return lerpColor(s.v0, s.v1, u);
      return u < 1 ? s.v0 : s.v1;
    }
    _resolveAt(opt) {
      if (opt === undefined || opt === null || opt === '>') return this.cursor;
      if (opt === '<') return this._prevStart;
      if (typeof opt === 'string') {
        if (opt[0] === '<' || opt[0] === '>') { const base = opt[0] === '<' ? this._prevStart : this.cursor; return base + parseFloat(opt.slice(1) || '0'); }
        if (this._labels && opt in this._labels) return this._labels[opt];
        return parseFloat(opt);
      }
      return opt;
    }
    _targets(target) {
      if (!target) return [];
      if (Array.isArray(target)) return target.flatMap(t => this._targets(t));
      if (target instanceof Prim) return [target];
      if (target.g instanceof Prim) return [target.g];       // composite objects (matrix, membox, tile…) animate their group
      return [];
    }
    /** Tween `vars` on target(s) over `dur` seconds. opts: {at, ease, stagger} */
    to(target, vars, dur, opts) {
      opts = opts || {}; dur = dur === undefined ? 0.6 : dur;
      const start = this._resolveAt(opts.at);
      const ease = EASE[opts.ease || 'inOut'] || EASE.inOut;
      const list = this._targets(target);
      const stagger = opts.stagger || 0;
      list.forEach((prim, i) => {
        const t0 = start + i * stagger, t1 = t0 + dur;
        for (const key in vars) {
          const prop = ALIAS[key] || key;
          const tr = this._track(prim, prop);
          const v0 = this._eval(tr, t0);
          const seg = { t0, t1, v0, v1: vars[key], ease: STEP_PROPS[prop] ? EASE.step : ease, prop };
          this._insert(tr, seg);
        }
      });
      const end = start + dur + Math.max(0, list.length - 1) * stagger;
      this._prevStart = start;
      if (opts.at === undefined || opts.at === null || opts.at === '>') this.cursor = end; else this.cursor = Math.max(this.cursor, end);
      this._end = Math.max(this._end, end);
      return this;
    }
    _insert(tr, seg) {
      const segs = tr.segs;
      // keep sorted by t0; truncate any earlier segment that would run past this one
      let i = segs.length;
      while (i > 0 && segs[i - 1].t0 > seg.t0) i--;
      segs.splice(i, 0, seg);
    }
    /** Instant set at time `at` (default: cursor). */
    set(target, vars, at) {
      const t = this._resolveAt(at);
      this._targets(target).forEach(prim => {
        for (const key in vars) {
          const prop = ALIAS[key] || key;
          const tr = this._track(prim, prop);
          this._insert(tr, { t0: t, t1: t, v0: vars[key], v1: vars[key], ease: EASE.step, prop });
        }
      });
      this._prevStart = t;
      this._end = Math.max(this._end, t);
      return this;
    }
    /** Move a group along a quadratic curve to (x,y). opts.via = [cx,cy] control point (absolute). */
    move(target, x, y, dur, opts) {
      opts = opts || {}; dur = dur === undefined ? 0.8 : dur;
      const start = this._resolveAt(opts.at);
      const ease = EASE[opts.ease || 'inOut'];
      const list = this._targets(target), stagger = opts.stagger || 0;
      list.forEach((prim, i) => {
        const t0 = start + i * stagger, t1 = t0 + dur;
        const trx = this._track(prim, 'tx'), tryy = this._track(prim, 'ty');
        const x0 = this._eval(trx, t0), y0 = this._eval(tryy, t0);
        const ox = opts.dx ? opts.dx * i : 0, oy = opts.dy ? opts.dy * i : 0;
        const X1 = (Array.isArray(x) ? x[i] : x) + ox, Y1 = (Array.isArray(y) ? y[i] : y) + oy;
        let cx, cy;
        if (opts.via) { cx = opts.via[0]; cy = opts.via[1]; }
        else if (opts.arc) { const mx = (x0 + X1) / 2, my = (y0 + Y1) / 2, dx = X1 - x0, dy = Y1 - y0, L = Math.hypot(dx, dy) || 1; cx = mx - dy / L * opts.arc; cy = my + dx / L * opts.arc; }
        const q = (a, c, b, u) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * c + u * u * b;
        const curveX = cx !== undefined ? u => q(x0, cx, X1, u) : null;
        const curveY = cy !== undefined ? u => q(y0, cy, Y1, u) : null;
        this._insert(trx, { t0, t1, v0: x0, v1: X1, ease, prop: 'tx', curve: curveX });
        this._insert(tryy, { t0, t1, v0: y0, v1: Y1, ease, prop: 'ty', curve: curveY });
      });
      const end = start + dur + Math.max(0, list.length - 1) * stagger;
      this._prevStart = start;
      if (opts.at === undefined || opts.at === null || opts.at === '>') this.cursor = end; else this.cursor = Math.max(this.cursor, end);
      this._end = Math.max(this._end, end);
      return this;
    }
    /** Advance the cursor without animating anything. */
    wait(dur) { this.cursor += dur; this._end = Math.max(this._end, this.cursor); return this; }
    /** Mark a narration step starting at the cursor (or at `at`). */
    step(caption, at) {
      const t = at === undefined ? this.cursor : this._resolveAt(at);
      this.steps.push({ t, caption, index: this.steps.length });
      this.steps.sort((a, b) => a.t - b.t); this.steps.forEach((s, i) => s.index = i);
      return this;
    }
    label(name) { this._labels = this._labels || {}; this._labels[name] = this.cursor; return this; }
    stepAt(t) {
      let out = null;
      for (const s of this.steps) { if (s.t <= t + 1e-9) out = s; else break; }
      return out || this.steps[0] || null;
    }
    /** Convenience: fade a target in/out. */
    show(target, dur, opts) { return this.to(target, { opacity: 1 }, dur === undefined ? 0.4 : dur, opts); }
    hide(target, dur, opts) { return this.to(target, { opacity: 0 }, dur === undefined ? 0.4 : dur, opts); }
    /** Pulse: briefly scale a (pivoted) group up and back. */
    pulse(target, amount, dur, opts) {
      amount = amount || 1.18; dur = dur || 0.5;
      const start = this._resolveAt(opts && opts.at);
      this.to(target, { scale: amount }, dur / 2, { at: start, ease: 'out' });
      this.to(target, { scale: 1 }, dur / 2, { at: start + dur / 2, ease: 'in' });
      return this;
    }
    render(t) {
      for (const [prim, m] of this.tracks) {
        for (const [prop, tr] of m) prim.apply(prop, this._eval(tr, t));
      }
    }
  }

  MB.scenes = [];
  MB.scene = (container, opts) => new Scene(container, opts);
  MB.Prim = Prim;

  // Self-test used by tools/smoke.py: render every scene across its whole
  // timeline and report anything that produced NaN/undefined attributes.
  MB.selfTest = function () {
    const report = [];
    MB.scenes.forEach((s, i) => {
      s.pause();
      const bad = new Set();
      const N = 90;
      for (let k = 0; k <= N; k++) {
        const t = (s.duration || 0) * k / N;
        try { s.tl.render(t); } catch (e) { bad.add('exception at t=' + t.toFixed(2) + ': ' + e.message); break; }
        const html = s.svg.innerHTML;
        if (html.indexOf('NaN') >= 0) bad.add('NaN attribute at t=' + t.toFixed(2));
        if (html.indexOf('"undefined"') >= 0) bad.add('undefined attribute at t=' + t.toFixed(2));
      }
      if (s.tl.steps.length === 0 && !s.hero) bad.add('no steps (captions) defined');
      if (s.duration === undefined) bad.add('S.finish() was never called');
      const steps = s.tl.steps.length;
      report.push(`scene ${i} (${s.container.id || 'no-id'}): duration ${(s.duration || 0).toFixed(1)}s, ${steps} steps${bad.size ? ' — ' + [...bad].join('; ') : ''}`);
      s.seek(0);
    });
    console.log('MB-SELFTEST\n' + report.join('\n'));
    return report;
  };
  window.addEventListener('load', () => {
    console.log('MB-SCENES ' + MB.scenes.length + ' scenes; anim divs: ' + document.querySelectorAll('.anim').length);
    if (location.hash === '#selftest') setTimeout(MB.selfTest, 50);
  });

  // Pause everything when the tab is hidden (saves battery; keeps clocks sane).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) MB.scenes.forEach(s => { if (s.playing) { s._wasPlaying = true; s.pause(); } });
    else MB.scenes.forEach(s => { if (s._wasPlaying && !s.userPaused) { s._wasPlaying = false; s.play(); } });
  });
})();
