// An illustrated relief view. Loaded when its panel is first opened.
import * as THREE from './assets/vendor/three/three.module.js';
import { OrbitControls } from './assets/vendor/three/OrbitControls.js';

const instances = new WeakMap();

export function mount(container, opts) {
  if (!(container instanceof HTMLElement)) throw new TypeError('A plan container is required.');
  if (!Array.isArray(opts?.levels) || !opts.levels.length) throw new TypeError('Plan levels are required.');
  instances.get(container)?.dispose();
  const abort = new AbortController(), cleanups = [], resources = new Set();
  const levels = opts.levels.map(level => ({ id: String(level.id), title: String(level.title || level.id) }));
  let current = levels.some(level => level.id === opts.current) ? opts.current : levels[0].id;
  let disposed = false, active = false, inView = true, raf = 0, dirty = true, hovered = null;
  let pendingHighlight = true;
  let detailTimer = 0, detailAbort = null, detailKey = '', detailTexture = null;
  let renderer, scene, camera, controls, data, resizeObserver, intersectionObserver;
  let fitScale = 1;
  const layers = new Map();
  const own = resource => { resources.add(resource); return resource; };
  const root = document.createElement('div'); root.className = 'relief-view';
  root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'relief view');
  const canvas = document.createElement('canvas'); canvas.className = 'relief-view-canvas';
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Relief view. Left drag rotates, right drag pans, wheel zooms. Touch: one finger rotates; two pan and zoom. Arrow keys rotate; plus and minus zoom; Home resets.');
  const tool = (name, label, path) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = name;
    button.title = label; button.setAttribute('aria-label', label);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', 'stroke-width':'2', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true', focusable:'false' })) svg.setAttribute(key, value);
    const shape = document.createElementNS(svg.namespaceURI, 'path'); shape.setAttribute('d', path); svg.append(shape); button.append(svg);
    return button;
  };
  const reset = tool('relief-view-reset', 'Reset relief view', 'M3 11 12 3l9 8M6 9v12h12V9M10 21v-7h4v7');
  const others = tool('relief-view-others', 'Other floors', 'm3 7 9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4');
  const otherModes = ['faded', 'shown', 'hidden'];
  let otherMode = 'faded'; try { otherMode = otherModes.includes(localStorage.getItem('relief-view-others')) ? localStorage.getItem('relief-view-others') : 'faded'; } catch { /* default */ }
  const state = document.createElement('span'); state.className = 'relief-view-state'; state.setAttribute('aria-hidden', 'true'); others.append(state);
  const announce = document.createElement('span'); announce.className = 'floor-plan-sr'; announce.setAttribute('aria-live', 'polite');
  function labelOthers() {
    const next = otherModes[(otherModes.indexOf(otherMode) + 1) % otherModes.length];
    const label = 'Other floors: ' + otherMode + '. Click to show ' + next + '.';
    others.title = label; others.setAttribute('aria-label', label); others.dataset.state = otherMode;
    state.textContent = { faded:'◐', shown:'●', hidden:'×' }[otherMode]; announce.textContent = 'Other floors: ' + otherMode;
  }
  labelOthers();
  const status = document.createElement('div'); status.className = 'relief-view-status';
  status.setAttribute('role', 'status'); status.textContent = 'Loading plan…';
  const toolbar = opts.toolbar || document.createElement('div');
  if (!opts.toolbar) { toolbar.className = 'floor-plan-toolbar relief-view-toolbar'; toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Relief view controls'); root.append(toolbar); }
  toolbar.append(reset, others);
  const stop = event => event.stopPropagation();
  const listen = (target, name, fn, options) => {
    target.addEventListener(name, fn, options); cleanups.push(() => target.removeEventListener(name, fn, options));
  };
  const pick = id => { if (!disposed && layers.has(id)) opts.onPick?.(id); };
  // Clockwise angle of north on screen, in radians, for the map's compass.
  const heading = () => { if (!disposed && controls) opts.onHeading?.(controls.getAzimuthalAngle()); };
  root.append(canvas, status, announce); container.append(root);
  listen(others, 'click', () => {
    otherMode = otherModes[(otherModes.indexOf(otherMode) + 1) % otherModes.length];
    labelOthers(); try { localStorage.setItem('relief-view-others', otherMode); } catch { /* per session only */ }
    highlight();
  });
  cleanups.push(() => { reset.remove(); others.remove(); });
  // Keep plan gestures inside its panel, including when mounted over a map.
  for (const name of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'keydown', 'contextmenu', 'touchstart', 'touchmove', 'touchend']) {
    listen(root, name, stop);
  }
  listen(root, 'contextmenu', event => event.preventDefault());

  function visible() {
    return !disposed && !document.hidden && inView && root.isConnected && root.getClientRects().length > 0 && root.clientWidth > 0 && root.clientHeight > 0;
  }
  function invalidate() {
    dirty = true;
    if (!active || disposed || !renderer || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!visible()) { syncVisibility(); return; }
      if (dirty && !disposed) { dirty = false; renderer.render(scene, camera); }
    });
  }
  // Only the current, on-screen floor gets detail. Base illustrations and one
  // native detail chain share the available budget; old detail is released before loading.
  function scheduleDetail() {
    clearTimeout(detailTimer);
    if (!active || !data || !layers.size) return;
    detailTimer = setTimeout(updateDetail, 180);
  }
  function clearDetail() {
    detailAbort?.abort(); detailAbort = null;
    for (const layer of layers.values()) layer.top.material.map = layer.texture;
    if (detailTexture) { resources.delete(detailTexture); detailTexture.dispose(); detailTexture = null; }
    detailKey = '';
  }
  async function updateDetail() {
    if (!visible() || !renderer || !camera) return;
    const spec = data.levels.find(level => level.id === current), layer = layers.get(current);
    if (!layer) return;
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const [x0,y0,x1,y1] = data.box, h = (spec.minHeight + spec.maxHeight) / 2;
    const points = [[x0,y0],[x1,y0],[x0,y1],[x1,y1]].map(([x,y]) => new THREE.Vector3(...position(x,y,h)).project(camera));
    const pixels = (a,b) => Math.hypot((a.x-b.x)*canvas.width/2, (a.y-b.y)*canvas.height/2);
    const aspect = (x1-x0)/(y1-y0);
    const need = Math.max(pixels(points[0],points[1]), pixels(points[2],points[3]),
      pixels(points[0],points[2])*aspect, pixels(points[1],points[3])*aspect);
    const tiers = (spec.textureLevels || []).filter(tier => tier.width <= renderer.capabilities.maxTextureSize && tier.height <= renderer.capabilities.maxTextureSize);
    let tier = tiers[0];
    if (frustum.intersectsObject(layer.top)) for (const candidate of tiers.slice(1)) {
      const previous = tiers[tiers.indexOf(candidate)-1];
      if (need > previous.width * 1.1) tier = candidate;
    }
    const key = tier && tier !== tiers[0] ? current + ':' + tier.width : '';
    if (key === detailKey) return;
    clearDetail(); invalidate();
    if (!key) return;
    detailKey = key; const request = detailAbort = new AbortController();
    try {
      const texture = await loadTexture(asset(tier.texture), AbortSignal.any([abort.signal, request.signal]));
      if (disposed || request !== detailAbort || !visible()) { resources.delete(texture); texture.dispose(); if (request === detailAbort) detailKey = ''; return; }
      detailTexture = texture; layer.top.material.map = texture; invalidate();
    } catch (error) {
      if (request === detailAbort) { detailKey = ''; if (error.name !== 'AbortError') root.dataset.detailError = 'true'; }
      // Keep the base illustration usable when an optional detail request fails.
    }
  }
  function resize() {
    if (!renderer || !visible()) return;
    const width = root.clientWidth, height = root.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    const aspect = width / height, half = 94 * fitScale * Math.max(1, .85 / aspect);
    camera.left = -half * aspect; camera.right = half * aspect;
    camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix();
    invalidate(); scheduleDetail();
  }
  function syncVisibility() {
    active = visible();
    if (controls) controls.enabled = active;
    if (!active && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!active) { clearTimeout(detailTimer); clearDetail(); }
    if (active) {
      if (pendingHighlight) highlight();
      resize();
    }
  }
  function position(px, py, height) {
    return [(px - data.mapSize[0] / 2) / data.pixelsPerUnit,
      height * data.verticalScale,
      ((py - data.mapSize[1] / 2) / data.pixelsPerUnit + data.northSin * height) / data.northCos];
  }
  function highlight() {
    pendingHighlight = false;
    if (data?.routesFollowLevels && scene) for (const route of scene.children) {
      if (route.userData.linkLevels) route.visible = otherMode !== 'hidden' || route.userData.linkLevels.some(id => id === current || id === hovered);
    }
    root.setAttribute('aria-label', 'Relief view: ' + (levels.find(level => level.id === current)?.title || ''));
    for (const [id, layer] of layers) {
      const selected = id === current, hover = id === hovered;
      const full = selected || otherMode === 'shown';
      layer.top.visible = selected || hover || otherMode !== 'hidden';
      layer.walls.visible = layer.top.visible && layer.wallsWanted !== false;
      for (const surface of [layer.top, layer.walls]) {
        surface.material.opacity = full ? 1 : hover ? .85 : .68;
        surface.material.userData.fade.value = full ? 0 : hover ? .25 : .64;
        // Opaque surfaces establish depth before the faded plans are blended.
        surface.material.transparent = !full;
        surface.material.depthWrite = full;
        surface.renderOrder = selected ? 0 : 1;
      }
    }
    invalidate();
  }
  function makeLayer(level, grid, texture) {
    const [nx, ny] = data.grid, [x0, y0, x1, y1] = data.box;
    const heights = new Float32Array(nx * ny), encoded = grid.heightRuns;
    let offset = 0;
    if (!Array.isArray(encoded) || encoded.length % 2) throw new Error('Invalid plan heights.');
    for (let i = 0; i < encoded.length; i += 2) {
      const count = encoded[i], value = encoded[i + 1] * data.heightUnit;
      if (!Number.isInteger(count) || count < 1 || offset + count > heights.length || !Number.isFinite(value)) throw new Error('Invalid plan heights.');
      heights.fill(value, offset, offset + count); offset += count;
    }
    if (offset !== heights.length) throw new Error('Incomplete plan heights.');
    const content = Uint8Array.from(atob(grid.content), c => c.charCodeAt(0));
    if (content.length !== (nx - 1) * (ny - 1)) throw new Error('Incomplete plan footprint.');
    const pos = [], uv = [], triangles = [], wallPos = [], wallUv = [];
    const sharedVertices = new Map();
    let vertexIds = new Int32Array(nx * ny).fill(-1), sheetHeights = heights;
    function vertex(x, y) {
      const index = y * nx + x;
      if (vertexIds[index] >= 0) return vertexIds[index];
      const key = index + ':' + Math.round(sheetHeights[index] / data.heightUnit);
      if (sharedVertices.has(key)) return vertexIds[index] = sharedVertices.get(key);
      const id = pos.length / 3;
      vertexIds[index] = id;
      sharedVertices.set(key, id);
      pos.push(...position(x0 + (x1 - x0) * x / (nx - 1), y0 + (y1 - y0) * y / (ny - 1), sheetHeights[index]));
      uv.push(x / (nx - 1), 1 - y / (ny - 1));
      return id;
    }
    for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      if (content[y * (nx - 1) + x] !== 1) continue;
      const a = vertex(x, y), b = vertex(x + 1, y), c = vertex(x, y + 1), d = vertex(x + 1, y + 1);
      triangles.push(a, c, b, b, c, d);
    }
    const sheets = [{ heights, content }];
    // A returning stair can pass above another flight on the same floor.
    // Each sheet remains a regular illustrated grid with its own shared vertices.
    for (const patch of grid.patches || []) {
      const ph = new Float32Array(nx * ny), pc = Uint8Array.from(atob(patch.content), c => c.charCodeAt(0));
      let k = 0;
      if (!Array.isArray(patch.heightRuns) || patch.heightRuns.length % 2 || pc.length !== content.length) throw new Error('Invalid stair surface.');
      for (let i = 0; i < patch.heightRuns.length; i += 2) {
        const count = patch.heightRuns[i], h = patch.heightRuns[i + 1] * data.heightUnit;
        if (!Number.isInteger(count) || count < 1 || k + count > ph.length || !Number.isFinite(h)) throw new Error('Invalid stair heights.');
        ph.fill(h, k, k + count); k += count;
      }
      if (k !== ph.length) throw new Error('Incomplete stair heights.');
      vertexIds = new Int32Array(nx * ny).fill(-1); sheetHeights = ph;
      for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
        if (pc[y * (nx - 1) + x] !== 1) continue;
        const a = vertex(x, y), b = vertex(x + 1, y), c = vertex(x, y + 1), d = vertex(x + 1, y + 1);
        triangles.push(a, c, b, b, c, d);
      }
      sheets.push({ heights: ph, content: pc });
    }
    if (!Array.isArray(grid.outlines)) throw new Error('Incomplete plan outline.');
    for (const outline of grid.outlines) {
      if (!Array.isArray(outline) || outline.length < 3) throw new Error('Invalid plan outline.');
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length];
        if (![...a, ...b].every(Number.isFinite)) throw new Error('Invalid plan outline.');
        const p = position(x0 + a[0], y0 + a[1], a[2]);
        const q = position(x0 + b[0], y0 + b[1], b[2]);
        const pp = [p[0], p[1] + data.wallHeight * data.verticalScale, p[2]];
        const qq = [q[0], q[1] + data.wallHeight * data.verticalScale, q[2]];
        wallPos.push(...p, ...q, ...pp, ...q, ...qq, ...pp);
        const u = [a[0] / (x1 - x0), 1 - a[1] / (y1 - y0)];
        const v = [b[0] / (x1 - x0), 1 - b[1] / (y1 - y0)];
        wallUv.push(...u, ...v, ...u, ...v, ...v, ...u);
      }
    }
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(triangles);
    const topMaterial = own(new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, alphaTest: .001, toneMapped: false }));
    const top = new THREE.Mesh(geometry, topMaterial); top.userData.level = level.id;
    const wallsGeometry = own(new THREE.BufferGeometry());
    wallsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
    wallsGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2));
    const walls = new THREE.Mesh(wallsGeometry, own(new THREE.MeshBasicMaterial({ color: level.wallColor, side: THREE.DoubleSide, toneMapped: false })));
    walls.visible = level.walls !== false; // trial without walls (owner, 2026-10-15)
    for (const surface of [top, walls]) {
      const fade = { value: 0 }; surface.material.userData.fade = fade;
      surface.material.onBeforeCompile = shader => {
        shader.uniforms.planFade = fade;
        shader.fragmentShader = 'uniform float planFade;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          float ink = dot(outgoingLight, vec3(.2126, .7152, .0722));
          vec3 paleInk = mix(vec3(.48, .48, .46), vec3(.76, .75, .71), ink);
          outgoingLight = mix(outgoingLight, paleInk, planFade);
          #include <opaque_fragment>
        `);
      };
      surface.material.customProgramCacheKey = () => 'plan-fade-v2';
    }
    walls.userData.level = level.id; scene.add(top, walls);
    return { top, walls, wallsWanted: level.walls !== false, heights, content, sheets, texture };
  }
  function release() {
    controls?.dispose();
    for (const resource of resources) resource.dispose();
    resources.clear(); layers.clear();
    renderer?.dispose(); renderer?.forceContextLoss();
  }
  const handle = {
    setCurrent(id) {
      if (disposed || !levels.some(level => level.id === id)) return;
      current = id; hovered = null; pendingHighlight = true;
      if (active) highlight();
      if (detailKey && !detailKey.startsWith(id + ':')) clearDetail();
      scheduleDetail();
    },
    setView() {}, // Compatibility with older hosts; the plan has no view frame.
    dispose() {
      if (disposed) return;
      disposed = true; active = false; abort.abort();
      clearTimeout(detailTimer); clearDetail();
      if (raf) cancelAnimationFrame(raf);
      resizeObserver?.disconnect(); intersectionObserver?.disconnect();
      for (const cleanup of cleanups) cleanup();
      release(); root.remove();
      if (instances.get(container) === handle) instances.delete(container);
    },
    ready: null
  };
  instances.set(container, handle);
  async function json(url) {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) throw new Error('The plan could not be loaded.');
    return response.json();
  }
  let asset;
  async function loadTexture(url, signal = abort.signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('The illustration could not be loaded.');
    const blob = await response.blob(), bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' });
    if (disposed || signal.aborted) { bitmap.close(); throw new DOMException('Aborted', 'AbortError'); }
    const texture = own(new THREE.Texture(bitmap)); texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.addEventListener('dispose', () => bitmap.close()); texture.needsUpdate = true;
    return texture;
  }
  handle.ready = (async () => {
    try {
      if (!opts.base) throw new Error('A relief address is required.');
      const base = new URL(String(opts.base).replace(/\/?$/, '/'), document.baseURI);
      asset = name => { const url = new URL(name, base); url.searchParams.set('v', 'relief-2'); return url; };
      data = await json(asset('plan.json'));
      if (disposed) return handle;
      if (data.version !== 3 || !data.grid || !data.box || !data.levels) throw new Error('This plan is unavailable.');
      scene = new THREE.Scene();
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
      fitScale = Math.max(1, (data.box[2]-data.box[0])/data.pixelsPerUnit/135, (data.box[3]-data.box[1])/data.pixelsPerUnit/data.northCos/135);
      camera = new THREE.OrthographicCamera(-84, 84, 94, -94, .1, 1500 * fitScale);
      const bottom = Math.min(...data.levels.map(level => level.minHeight));
      const top = Math.max(...data.levels.map(level => level.maxHeight));
      const target = new THREE.Vector3(0, (top + bottom) / 2 + 5, 0);
      // Start, and reset, with north up as on the map; the camera looks north from the south.
      camera.position.copy(target).add(new THREE.Vector3(0, 150, 248.4).multiplyScalar(fitScale));
      controls = new OrbitControls(camera, canvas); controls.target.copy(target);
      controls.enablePan = true; controls.enableDamping = false; controls.screenSpacePanning = true;
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      controls.minPolarAngle = Math.PI / 6; controls.maxPolarAngle = Math.PI * .43;
      controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity; // turn freely all the way round
      controls.minZoom = .72; controls.maxZoom = 6; controls.zoomSpeed = 9; controls.rotateSpeed = .6;
      controls.update(); controls.saveState();
      controls.addEventListener('change', () => {
        const bounded = controls.target.clone().clamp(target.clone().addScalar(-40 * fitScale), target.clone().addScalar(40 * fitScale));
        camera.position.add(bounded.clone().sub(controls.target)); controls.target.copy(bounded);
        invalidate(); scheduleDetail(); heading();
      });
      listen(reset, 'click', () => { controls.reset(); invalidate(); heading(); });
      heading();
      // Fetch in parallel and register each resource before another request can fail.
      await Promise.all(levels.map(async level => {
        const spec = data.levels.find(item => item.id === level.id);
        if (!spec) throw new Error('This floor is unavailable.');
        const [grid, texture] = await Promise.all([json(asset(spec.heightMap)), loadTexture(asset(spec.texture))]);
        if (disposed || abort.signal.aborted) return;
        layers.set(level.id, makeLayer(spec, grid, texture));
      }));
      if (disposed) return handle;
      // Keep a visible dashed route for shafts and other unjoined passages.
      if (Array.isArray(opts.links) && opts.links.length) {
        const surfaceHeight = (id, px, py) => {
          const spec = data.levels.find(item => item.id === id), layer = layers.get(id);
          if (!spec || !layer) return null;
          const [nx, ny] = data.grid, [x0,y0,x1,y1] = data.box;
          const gx = THREE.MathUtils.clamp((px-x0)/(x1-x0)*(nx-1),0,nx-1-1e-8);
          const gy = THREE.MathUtils.clamp((py-y0)/(y1-y0)*(ny-1),0,ny-1-1e-8);
          const x = Math.floor(gx), y = Math.floor(gy), u = gx-x, v = gy-y, values = [];
          for (const sheet of layer.sheets) {
            if (!sheet.content[y*(nx-1)+x]) continue;
            const h = sheet.heights, k = y*nx+x;
            values.push(u+v<=1 ? h[k]*(1-u-v)+h[k+1]*u+h[k+nx]*v : h[k+1]*(1-v)+h[k+nx]*(1-u)+h[k+nx+1]*(u+v-1));
          }
          return values.length ? Math.max(...values) : spec.height;
        };
        const material = own(new THREE.MeshBasicMaterial({ color: 0xb4501e, depthTest: false, transparent: true, opacity: .95 }));
        const dot = own(new THREE.SphereGeometry(.65, 10, 8));
        for (const link of opts.links) {
          if (!link?.a || !link?.b) continue;
          if (data.joinedLinks?.some(pair => (pair.a === link.a.id && pair.b === link.b.id) || (pair.a === link.b.id && pair.b === link.a.id))) continue;
          const ha = surfaceHeight(link.a.level, link.a.x, link.a.y), hb = surfaceHeight(link.b.level, link.b.x, link.b.y);
          if (ha === null || hb === null) continue;
          const pa = new THREE.Vector3(...position(link.a.x, link.a.y, ha)), pb = new THREE.Vector3(...position(link.b.x, link.b.y, hb));
          if (![...pa,...pb].every(Number.isFinite)) continue;
          const route = new THREE.Group(); route.userData.link = [link.a.id,link.b.id]; route.userData.linkLevels = [link.a.level,link.b.level];
          const length = pa.distanceTo(pb), direction = pb.clone().sub(pa).normalize();
          for (let start = 0; start < length; start += 2.7) {
            const end = Math.min(length, start + 1.6);
            const curve = new THREE.LineCurve3(pa.clone().addScaledVector(direction,start),pa.clone().addScaledVector(direction,end));
            const dash = new THREE.Mesh(own(new THREE.TubeGeometry(curve,1,.45,6,false)),material); dash.renderOrder = 5; route.add(dash);
          }
          for (const p of [pa,pb]) { const m = new THREE.Mesh(dot,material); m.position.copy(p); m.renderOrder = 6; route.add(m); }
          scene.add(route);
        }
      }
      const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
      function hit(event) {
        const rect = canvas.getBoundingClientRect();
        pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        ray.setFromCamera(pointer, camera);
        const hits = ray.intersectObjects([...layers.values()].flatMap(layer => [layer.top, layer.walls]));
        for (const intersection of hits) {
          const id = intersection.object.userData.level, layer = layers.get(id);
          if (intersection.uv) {
            // Ignore transparent paper in the textured footprint when picking.
            const uv = intersection.uv, image = layer.alpha;
            const x = Math.min(image.width - 1, Math.max(0, Math.floor(uv.x * image.width)));
            const y = Math.min(image.height - 1, Math.max(0, Math.floor((1 - uv.y) * image.height)));
            if (image.data[(y * image.width + x) * 4 + 3] < 32) continue;
          }
          return id;
        }
        return null;
      }
      // Picking uses the same alpha cutout as the art, with no readback during pointer movement.
      for (const layer of layers.values()) {
        const image = layer.texture.image, scratch = document.createElement('canvas');
        scratch.width = 256; scratch.height = Math.round(256 * image.height / image.width);
        const context = scratch.getContext('2d', { willReadFrequently: true });
        // ImageBitmap is flipped for the texture; restore top-left order for the alpha test.
        context.setTransform(1, 0, 0, -1, 0, scratch.height); context.drawImage(image, 0, 0, scratch.width, scratch.height);
        layer.alpha = context.getImageData(0, 0, scratch.width, scratch.height);
        scratch.width = scratch.height = 0;
      }
      let down = null, dragging = false;
      const pointers = new Set();
      listen(canvas, 'pointerdown', event => { pointers.add(event.pointerId); if (pointers.size > 1) { dragging = true; down = null; return; } down = { x: event.clientX, y: event.clientY, button: event.button }; dragging = false; });
      listen(canvas, 'pointermove', event => {
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) dragging = true;
        if (dragging) return;
        const id = hit(event);
        if (hovered !== id) { hovered = id; canvas.style.cursor = id ? 'pointer' : 'grab'; highlight(); }
      });
      listen(canvas, 'pointerleave', () => { hovered = null; highlight(); });
      listen(canvas, 'pointercancel', event => { pointers.delete(event.pointerId); down = null; dragging = false; });
      listen(canvas, 'pointerup', event => {
        pointers.delete(event.pointerId);
        if (down && !dragging && down.button === 0) { const id = hit(event); if (id) pick(id); }
        down = null; dragging = false;
      });
      listen(canvas, 'keydown', event => {
        const offsets = { ArrowLeft: [-.15, 0], ArrowRight: [.15, 0], ArrowUp: [0, -.12], ArrowDown: [0, .12] };
        if (offsets[event.key]) {
          event.preventDefault();
          const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
          spherical.theta = THREE.MathUtils.clamp(spherical.theta + offsets[event.key][0], controls.minAzimuthAngle, controls.maxAzimuthAngle);
          spherical.phi = THREE.MathUtils.clamp(spherical.phi + offsets[event.key][1], controls.minPolarAngle, controls.maxPolarAngle);
          camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical)); controls.update();
        } else if (['+', '=', '-'].includes(event.key)) {
          event.preventDefault(); camera.zoom = THREE.MathUtils.clamp(camera.zoom * (event.key === "-" ? .7 : 1.4), controls.minZoom, controls.maxZoom); camera.updateProjectionMatrix(); invalidate(); scheduleDetail();
        } else if (event.key === 'Home') { event.preventDefault(); controls.reset(); }
      });
      listen(canvas, 'webglcontextlost', event => { event.preventDefault(); status.hidden = false; status.textContent = 'The plan paused. Reopen it to try again.'; });
      listen(canvas, 'webglcontextrestored', () => { status.hidden = true; invalidate(); });
      resizeObserver = new ResizeObserver(syncVisibility); resizeObserver.observe(root);
      intersectionObserver = new IntersectionObserver(entries => { inView = entries.at(-1).isIntersecting; syncVisibility(); });
      intersectionObserver.observe(root); listen(document, 'visibilitychange', syncVisibility);
      listen(window, 'resize', syncVisibility);
      status.hidden = true; syncVisibility();
      return handle;
    } catch (error) {
      abort.abort();
      if (!disposed) { release(); status.hidden = false; status.textContent = 'The relief view is unavailable. Try reopening it.'; reset.hidden = true; others.hidden = true; }
      if (!disposed && error.name !== 'AbortError') throw error;
      return handle;
    }
  })();
  // Callers can await ready for error handling; unobserved failures still have a visible fallback.
  handle.ready.catch(() => {});
  return handle;
}

window.atlasRelief = { mount };
