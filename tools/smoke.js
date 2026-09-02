#!/usr/bin/env node
/* Smoke-test a chapter page WITHOUT a browser (runs in ~1 s).
 *
 *   node tools/smoke.js ch04-kernel-1-naive.html [more.html ...]
 *
 * A minimal fake DOM runs assets/anim.js, assets/nav.js and the page's inline
 * <script>, then MB.selfTest() renders every animation across its whole timeline.
 * It reports: JS errors (with HTML line numbers), figure containers that never
 * became a scene, scenes where S.finish() was not called, NaN/undefined
 * attributes at any time, missing captions, and use of setTimeout/setInterval
 * (not allowed — everything must be a tween). Exit code 1 on any problem.
 * It cannot see layout: still open the page in a browser and step through it. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

class ClassList {
  constructor(el) { this.el = el; }
  _get() { return (this.el.attrs.class || '').split(/\s+/).filter(Boolean); }
  _set(a) { this.el.attrs.class = a.join(' '); }
  add(...cs) { const s = new Set(this._get()); cs.forEach(c => s.add(c)); this._set([...s]); }
  remove(...cs) { const s = new Set(this._get()); cs.forEach(c => s.delete(c)); this._set([...s]); }
  contains(c) { return this._get().includes(c); }
  toggle(c, f) { const has = this.contains(c); const want = f === undefined ? !has : !!f; if (want) this.add(c); else this.remove(c); return want; }
}
class El {
  constructor(tag, doc, svg) {
    // like a browser: HTML elements report an upper-case tagName, SVG elements (createElementNS) keep their case
    this.tagName = svg ? (tag || 'g') : (tag || 'div').toUpperCase(); this.attrs = {}; this.children = []; this.parentNode = null;
    this._text = ''; this.style = {}; this.classList = new ClassList(this); this.doc = doc; doc._all.push(this);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  appendChild(c) { if (c.parentNode) c.parentNode.children = c.parentNode.children.filter(x => x !== c); c.parentNode = this; this.children.push(c); return c; }
  prepend(c) { c.parentNode = this; this.children.unshift(c); }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  addEventListener() {} removeEventListener() {} focus() {} blur() {} contains() { return false; }
  get id() { return this.attrs.id || ''; } set id(v) { this.attrs.id = v; }
  get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = v; }
  set tabIndex(v) { this.attrs.tabindex = String(v); } get tabIndex() { return +(this.attrs.tabindex || -1); }
  get textContent() { return this._text; } set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get innerHTML() { return this.children.map(c => c.outerHTML).join('') + esc(this._text); }
  set innerHTML(v) { this.children = []; this._text = ''; this._raw = String(v); }
  get outerHTML() {
    const t = this.tagName.toLowerCase();
    const a = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return `<${t}${a}>${this.innerHTML}</${t}>`;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || new El('div', this.doc); }
  querySelectorAll(sel) { const out = []; const walk = n => n.children.forEach(c => { if (this.doc._match(c, sel)) out.push(c); walk(c); }); walk(this); return out; }
  getBoundingClientRect() { return { top: 0, left: 0, width: 900, height: 500, right: 900, bottom: 500 }; }
}
function makeDocument(html) {
  const doc = { _all: [] };
  doc._match = (el, sel) => sel.split(',').some(s => {
    s = s.trim(); const m = s.match(/^([a-zA-Z]*)(#[\w-]+)?((?:\.[\w-]+)*)$/); if (!m) return false;
    if (m[1] && el.tagName.toUpperCase() !== m[1].toUpperCase()) return false;
    if (m[2] && el.id !== m[2].slice(1)) return false;
    const cls = (m[3] || '').split('.').filter(Boolean);
    return cls.every(c => el.classList.contains(c));
  });
  doc.documentElement = new El('html', doc); doc.body = new El('body', doc); doc.documentElement.appendChild(doc.body);
  doc.hidden = false;
  doc.createElement = t => new El(t, doc);
  doc.createElementNS = (ns, t) => new El(t, doc, true);
  doc.getElementById = id => doc._all.find(e => e.id === id) || null;
  doc.querySelector = sel => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = sel => doc.documentElement.querySelectorAll(sel);
  doc.addEventListener = () => {}; doc.removeEventListener = () => {};
  // materialise the page's own elements that scripts look up: anything with an id, plus nav/pager/cover-grid hooks
  const re = /<(div|nav|figure|span|section|main|article|p)\b([^>]*)>/g; let m;
  while ((m = re.exec(html))) {
    const attrs = m[2]; const id = (attrs.match(/\bid="([^"]+)"/) || [])[1]; const cls = (attrs.match(/\bclass="([^"]+)"/) || [])[1];
    if (!id && !cls) continue;
    const e = new El(m[1], doc); if (id) e.id = id; if (cls) e.className = cls; doc.body.appendChild(e);
  }
  return doc;
}

function run(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { console.log(`== ${file}\n  ERROR: file not found`); return false; }
  const html = fs.readFileSync(full, 'utf8');
  const doc = makeDocument(html);
  const problems = [];
  let timers = 0;
  const loadHandlers = [];
  const sandbox = {
    document: doc, console,
    location: { pathname: '/' + file, hash: '#selftest', href: 'http://localhost/' + file + '#selftest' },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    setTimeout: () => { timers++; return 1; }, setInterval: () => { timers++; return 1; }, clearTimeout: () => {}, clearInterval: () => {},
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener: (ev, fn) => { if (ev === 'load') loadHandlers.push(fn); },
    removeEventListener: () => {}, devicePixelRatio: 1, innerWidth: 1300, innerHeight: 900, scrollY: 0, scrollTo() {}, scrollBy() {},
    navigator: { userAgent: 'smoke' }, performance: { now: () => Date.now() },
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  // scripts in document order
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g; let m; let ok = true;
  while ((m = re.exec(html))) {
    const src = (m[1].match(/\bsrc="([^"]+)"/) || [])[1];
    let code, name, lineOffset = 0;
    if (src) { const p = path.join(ROOT, src); if (!fs.existsSync(p)) { problems.push(`script not found: ${src}`); ok = false; continue; } code = fs.readFileSync(p, 'utf8'); name = src; }
    else { code = m[2]; name = file + ' (inline script)'; lineOffset = html.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1; }
    try { vm.runInContext(code, ctx, { filename: name, lineOffset }); }
    catch (e) {
      ok = false;
      const where = (e.stack || '').split('\n').find(l => /\(.*:\d+:\d+\)|at .*:\d+:\d+/.test(l)) || '';
      problems.push(`JS error in ${name}: ${e.message}  ${where.trim()}`);
    }
  }
  const MB = sandbox.MB;
  if (!MB || !MB.scenes) { problems.push('assets/anim.js did not load (no MB.scenes)'); ok = false; }
  else {
    const pageTimers = timers;   // timers requested by the page's own scripts (anim.js's load hook uses one legitimately)
    const origLog0 = console.log; console.log = () => {};
    try { loadHandlers.forEach(fn => fn()); } catch (e) { ok = false; problems.push('error in load handler: ' + e.message); }
    console.log = origLog0; timers = pageTimers;
    // every animation container in a <figure> must have become a scene
    const figIds = [...html.matchAll(/<figure\b[^>]*>\s*<div\s+id="([^"]+)"/g)].map(x => x[1]);
    const sceneIds = new Set(MB.scenes.map(s => s.container && s.container.id));
    figIds.forEach(id => { if (!sceneIds.has(id)) { ok = false; problems.push(`figure container #${id} never became a scene (MB.scene('${id}', …) missing or crashed)`); } });
    MB.scenes.forEach((s, i) => { if (s.duration === undefined) { ok = false; problems.push(`scene ${i} (#${s.container.id}): S.finish() was never called`); } });
    let report = [];
    try { const origLog = console.log; console.log = () => {}; report = MB.selfTest(); console.log = origLog; }
    catch (e) { ok = false; problems.push('selfTest crashed: ' + e.message); }
    console.log(`== ${file}`);
    report.forEach(line => {
      const bad = /—|no steps/.test(line);
      if (bad) ok = false;
      console.log(`   ${bad ? 'PROBLEM ' : ''}${line}`);
    });
    MB.scenes.forEach((s, i) => {
      if (s.hero) return;
      const d = s.duration || 0;
      if (d < 6) problems.push(`scene ${i} (#${s.container.id}) is only ${d.toFixed(1)} s long — too short to read`);
      if (d > 75) problems.push(`scene ${i} (#${s.container.id}) is ${d.toFixed(1)} s long — consider splitting`);
      s.tl.steps.forEach((st, k) => { if (!st.caption || st.caption.trim().length < 20) { ok = false; problems.push(`scene ${i} step ${k + 1}: caption missing or too short`); } });
    });
  }
  if (timers) { ok = false; problems.push(`page calls setTimeout/setInterval ${timers}× — express everything as tweens instead`); }
  if (!MB || !MB.scenes) console.log(`== ${file}`);
  problems.forEach(p => console.log('   ' + (/^scene \d+ .* is (only|.*long)/.test(p) ? 'WARNING ' : 'ERROR ') + p));
  console.log('   RESULT:', ok ? 'OK' : 'PROBLEMS FOUND');
  return ok;
}

// ---- optional: dump every step's final frame as standalone SVG (for tools/frames.py)
const FONTS = { 'f-sans': 'Inter, Helvetica, Arial, sans-serif', 'f-mono': 'JetBrains Mono, Menlo, monospace', 'f-serif': 'Newsreader, Georgia, serif' };
function toSVG(node, root) {
  const t = node.tagName.toLowerCase();
  const attrs = Object.assign({}, node.attrs);
  if (root) { attrs.xmlns = 'http://www.w3.org/2000/svg'; attrs.width = 900; delete attrs.class; }
  if (t === 'text') {
    const cls = (attrs.class || '').split(/\s+/).find(c => FONTS[c]);
    attrs['font-family'] = FONTS[cls] || FONTS['f-sans'];
    if (attrs['dominant-baseline'] === 'middle') { attrs.dy = '0.35em'; }
    delete attrs['dominant-baseline'];
  }
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return `<${t}${a}>${node.children.map(c => toSVG(c, false)).join('')}${esc(node._text)}</${t}>`;
}
function dumpFrames(file, dir) {
  const full = path.join(ROOT, file), html = fs.readFileSync(full, 'utf8');
  const doc = makeDocument(html); const loadHandlers = [];
  const sandbox = { document: doc, console: { log() {}, warn() {}, error() {} }, location: { pathname: '/' + file, hash: '#selftest', href: '' },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, setInterval: () => 1, clearTimeout() {}, clearInterval() {},
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: (ev, fn) => { if (ev === 'load') loadHandlers.push(fn); }, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 1300, innerHeight: 900, scrollY: 0, scrollTo() {}, scrollBy() {}, navigator: {}, performance: { now: () => Date.now() } };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(html))) {
    const src = (m[1].match(/\bsrc="([^"]+)"/) || [])[1];
    const code = src ? fs.readFileSync(path.join(ROOT, src), 'utf8') : m[2];
    vm.runInContext(code, ctx, { filename: src || file });
  }
  const MB = sandbox.MB; if (!MB) return;
  fs.mkdirSync(dir, { recursive: true });
  const stem = file.replace(/\.html$/, '');
  const index = [];
  MB.scenes.forEach((s, i) => {
    const steps = s.tl.steps, dur = s.duration || 0;
    const frames = steps.length ? steps.map((st, k) => ({ t: Math.max(0, (k + 1 < steps.length ? steps[k + 1].t : dur) - 0.05), caption: st.caption, step: k + 1 }))
      : [{ t: dur * 0.33, caption: '(hero, 1/3)', step: 1 }, { t: dur * 0.66, caption: '(hero, 2/3)', step: 2 }];
    frames.forEach(fr => {
      s.tl.render(fr.t);
      const name = `${stem}__${s.container.id || 'scene' + i}__s${String(fr.step).padStart(2, '0')}.svg`;
      fs.writeFileSync(path.join(dir, name), toSVG(s.svg, true));
      index.push({ file: name, scene: s.container.id || 'scene' + i, step: fr.step, t: +fr.t.toFixed(2), caption: fr.caption.replace(/<[^>]+>/g, '') });
    });
  });
  fs.writeFileSync(path.join(dir, stem + '__frames.json'), JSON.stringify(index, null, 1));
  console.log(`   frames: ${index.length} SVGs written to ${dir}`);
}

const args = process.argv.slice(2);
const fi = args.indexOf('--frames');
const framesDir = fi >= 0 ? args[fi + 1] : null;
if (fi >= 0) args.splice(fi, 2);
const pages = args.length ? args : fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const results = pages.map(p => { const ok = run(p); if (framesDir) { try { dumpFrames(p, framesDir); } catch (e) { console.log('   frames: FAILED ' + e.message); } } return ok; });
process.exit(results.every(Boolean) ? 0 : 1);
