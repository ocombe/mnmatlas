// Corner illustrated plan and existing map exchange places inside the map frame.
(() => {
 'use strict';
 const $ = id => document.getElementById(id);
 const active = () => typeof config === 'undefined' ? null : config;
 const planLevels = entry => entry.levels?.length ? entry.levels.map(level => ({ id:level.id, title:level.title })) : [{ id:entry.defaultLevel || 'floor-1', title:entry.title }];
 const buttons = () => [...($('level-controls')?.querySelectorAll('button[data-level]') || [])];
 const pref = value => { try { if (value === undefined) return localStorage.getItem('floor-plan-size'); localStorage.setItem('floor-plan-size', value); } catch { return null; } };
 // The corner plan stays folded to its header bar once a visitor hides it.
 const foldPref = value => { try { if (value === undefined) return localStorage.getItem('floor-plan-folded') === '1'; localStorage.setItem('floor-plan-folded', value ? '1' : '0'); } catch { return false; } };
 const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
 const icon = inward => inward ? 'M5 10h5V5M10 10 4 4M19 10h-5V5M14 10l6-6M5 14h5v5M10 14l-6 6M19 14h-5v5M14 14l6 6' : 'M4 9V4h5M4 4l6 6M15 4h5v5M20 4l-6 6M4 15v5h5M4 20l6-6M20 15v5h-5M20 20l-6-6';
 function control(cls, label, inward = false) {
  const b = el('button', cls); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', icon(inward)); svg.append(path); b.append(svg); return b;
 }
 let built = null, modulePromise = null, mapReady = false, readyTimer;
 function afterMap() {
  clearTimeout(readyTimer); mapReady = false;
  const settle = () => {
   if ([...document.querySelectorAll('#map img')].some(image => !image.complete)) { readyTimer = setTimeout(settle, 100); return; }
   mapReady = true; sync();
  };
  readyTimer = setTimeout(settle, 150);
 }
 const resizeMap = () => requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))));
 function build(key, entry) {
  const frame = $('map-frame'), map = $('map');
  if (!frame || !map) return null;
  const marker = document.createComment('map position'); map.before(marker);
  const panel = el('div', 'floor-stack'); panel.id = 'floor-stack';
  const head = el('div', 'floor-stack-head'), fold = el('button', 'floor-stack-toggle', 'Alternate view'); fold.type = 'button';
  const size = control('floor-stack-size', 'Expand relief view');
  const stage = el('div', 'floor-stack-plan'), slot = el('div', 'floor-stack-map');
  const shrink = control('floor-plan-shrink', 'Back to 2D map', true);
  const actions = el('div', 'floor-plan-actions');
  const fullTools = el('div', 'floor-plan-toolbar floor-plan-full-tools');
  fullTools.setAttribute('role', 'group'); fullTools.setAttribute('aria-label', 'Relief view controls');
  fullTools.append(shrink);
  const mapTools = frame.querySelector('.map-tools');
  const phoneOpen = el('button', 'floor-plan-open', 'Relief'); phoneOpen.type = 'button';
  phoneOpen.title = 'Open relief view'; phoneOpen.setAttribute('aria-label', 'Open relief view');
  (mapTools || frame).prepend(phoneOpen);
  const phoneQuery = matchMedia('(max-width:760px), (max-height:500px) and (pointer:coarse)');
  let phone = phoneQuery.matches;
  head.append(fold, size, actions); panel.append(head, stage, slot); frame.append(panel);
  let plan = null, loading = null, disposed = false, big = pref() === 'full', folded = foldPref(), north = 0;
  // While the relief fills the frame, the map compass turns with it.
  function compass() {
   const rose = frame.querySelector('.compass'); if (!rose) return;
   const turn = big && plan && !disposed ? north : 0;
   // Turn about the rose's centre: the rose is as tall as the compass is wide.
   rose.style.transformOrigin = turn ? `50% ${rose.offsetHeight - rose.offsetWidth / 2}px` : '';
   rose.style.transform = turn ? `rotate(${turn}rad)` : '';
  }
  const levels = planLevels(entry), passages = originals.map(m => ({...m}));
  let current = active()?.levelId || entry.defaultLevel || levels[0].id;
  const select = id => buttons().find(b => b.dataset.level === id)?.click();
  // Paired map passages; the plan omits dashes for stairs with shared landings.
  async function floorLinks() {
   try {
    const rows = passages, byId = new Map(rows.map(m => [m.id, m])), seen = new Set(), out = [];
    for (const m of rows) {
     const other = m.toMarker && byId.get(m.toMarker);
     if (!other || !m.level || !other.level || m.level === other.level) continue;
     const key = [m.id, other.id].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
     out.push({ a: { id: m.id, level: m.level, x: m.x, y: m.y }, b: { id: other.id, level: other.level, x: other.x, y: other.y } });
    }
    return out;
   } catch { return []; }
  }
  async function ensurePlan() {
   if (disposed || !mapReady || (!big && (folded || phone)) || plan || loading) return;
   loading = (async () => {
    try {
     modulePromise ||= import('./relief-view.js?v=relief-3').catch(e => { modulePromise = null; throw e; });
     const { mount } = await modulePromise;
     if (disposed || (!big && (folded || phone))) return;
     const links = await floorLinks();
     if (disposed || (!big && (folded || phone))) return;
     stage.replaceChildren();
     plan = mount(stage, { base: entry.relief, levels, current, onPick:select, toolbar:actions, links, onHeading: angle => { north = angle; compass(); } });
     await plan.ready;
    } catch {
     plan?.dispose(); plan = null;
     if (!disposed) { const retry = el('button', 'floor-plan-retry', 'Plan unavailable. Try again'); retry.type = 'button'; retry.onclick = ensurePlan; stage.replaceChildren(retry); }
    }
   })();
   try { await loading; } finally { loading = null; }
  }
  function placeTools() {
   if (disposed || !mapTools) return;
   // Follow the host's desktop, embed and single-map tool positions.
   const style = getComputedStyle(mapTools), button = mapTools.querySelector('button:not(.floor-plan-open)');
   frame.style.setProperty('--plan-tools-top', style.top);
   frame.style.setProperty('--plan-tools-right', phone ? style.right : (parseFloat(style.right) + mapTools.offsetWidth + 8) + 'px');
   frame.style.setProperty('--plan-tool-width', phone ? '44px' : (button?.offsetWidth || 36) + 'px');
   frame.style.setProperty('--plan-tool-height', phone ? '44px' : (button?.offsetHeight || 35) + 'px');
  }
  function apply() {
   panel.classList.toggle('collapsed', folded); fold.setAttribute('aria-expanded', String(!folded)); fold.setAttribute('aria-label', (folded ? 'Show ' : 'Hide ') + fold.textContent.toLowerCase());
   fold.setAttribute('aria-controls', 'floor-corner-content'); (big ? slot : stage).id = 'floor-corner-content'; (big ? stage : slot).removeAttribute('id');
   frame.classList.toggle('floor-plan-full', big); frame.classList.toggle('floor-plan-phone', phone); panel.classList.toggle('floor-stack-big', big);
   if (big) { slot.append(map); frame.append(stage, fullTools); fullTools.append(actions); }
   else { marker.after(map); panel.append(stage); head.append(actions); fullTools.remove(); }
   const label = big ? 'Expand map' : 'Expand relief view'; size.setAttribute('aria-label', label); size.title = label;
   size.hidden = folded; actions.hidden = !big && folded;
   placeTools(); resizeMap(); ensurePlan(); compass();
  }
  function swap() {
   big = !big; pref(big ? 'full' : 'mini'); apply();
   // Focus follows the view being opened, including keyboard and touch users.
   (big ? shrink : phone ? phoneOpen : folded ? fold : size).focus({preventScroll:true});
  }
  size.onclick = swap; shrink.onclick = swap; phoneOpen.onclick = swap; fold.onclick = () => { folded = !folded; foldPref(folded); apply(); };
  const phoneChange = () => { phone = phoneQuery.matches; apply(); };
  phoneQuery.addEventListener('change', phoneChange);
  window.addEventListener('resize', placeTools);
  const toolsObserver = new ResizeObserver(placeTools); if (mapTools) toolsObserver.observe(mapTools);
  // Leaflet owns gestures. Only a plain stationary click swaps; markers and controls keep their actions.
  let down = null, dragged = false, pointers = new Set();
  const start = e => { pointers.add(e.pointerId); if (pointers.size > 1) dragged = true; else { down = [e.clientX,e.clientY]; dragged = false; } };
  const move = e => { if (down && Math.hypot(e.clientX-down[0],e.clientY-down[1]) > 5) dragged = true; };
  const end = e => { pointers.delete(e.pointerId); };
  const click = e => { if (big && !dragged && !e.target.closest('.leaflet-control,.leaflet-marker-icon,.leaflet-popup,.leaflet-interactive') && (e.button === 0 || e.button === undefined)) swap(); };
  const cancel = e => { dragged = true; pointers.delete(e.pointerId); };
  const listeners = [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',cancel],['click',click]];
  for (const [event,fn] of listeners) map.addEventListener(event,fn);
  apply();
  return { key, ensurePlan, update() { current = active()?.levelId || entry.defaultLevel || levels[0].id; plan?.setCurrent(current); ensurePlan(); }, dispose() {
   disposed = true; plan?.dispose(); compass(); for (const [event,fn] of listeners) map.removeEventListener(event,fn);
   phoneQuery.removeEventListener('change', phoneChange); window.removeEventListener('resize', placeTools); toolsObserver.disconnect();
   phoneOpen.remove(); fullTools.remove(); frame.classList.remove('floor-plan-phone');
   for (const prop of ['--plan-tools-top','--plan-tools-right','--plan-tool-width','--plan-tool-height']) frame.style.removeProperty(prop);
   marker.after(map); marker.remove(); panel.remove(); stage.remove(); shrink.remove(); frame.classList.remove('floor-plan-full'); resizeMap();
  } };
 }
 function sync() {
  const entry = active();
  const local = value => typeof value === 'string' && /^[a-zA-Z0-9_./-]+$/.test(value) && !value.startsWith('/') && !value.split('/').includes('..');
  const key = entry && local(entry.relief) ? JSON.stringify([entry.id, entry.relief, entry.markersFile, planLevels(entry)]) : '';
  if (built && built.key !== key) { built.dispose(); built = null; }
  if (key && !built) built = build(key, entry);
  built?.update();
 }
 function start() {
  const controls = $('level-controls') || $('map-frame'); if (!controls) return;
  new MutationObserver(sync).observe(controls, {childList:true,subtree:true,attributes:true,attributeFilter:['aria-pressed']});
  window.addEventListener('atlas:loaded', afterMap);
  if (document.body.dataset.ready === 'true') afterMap();
  sync();
 }
 if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
