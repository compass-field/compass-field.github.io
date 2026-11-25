// "Try it yourself": draw an action chunk on a 2D version of the task field.
// Pieces are cut from a photo of the completed tiger (one per real peg), so a finished puzzle is the real tiger.
// The user plays the policy: each drag is one chunk. The field checks it with paper Eq. 3 (progress toward the
// stage goal, no pass over a non-target region); a rejected chunk is replaced by a field correction (Eq. 4).
// Ending a chunk on a handle grasps that piece; a held piece moves rigidly with the gripper; near its spot
// (inside the policy workspace) it slides in. Units: centimetres, x right, y down.
(function () {
  "use strict";
  const root = document.getElementById("p2d");
  if (!root) return;
  const DIR = "static/puzzle2d/";
  const cv = root.querySelector("canvas"), ctx = cv.getContext("2d");
  const $ = (s) => root.querySelector(s);
  const ui = {
    seg: root.querySelectorAll("[data-field]"), release: $("#p2d-release"), reset: $("#p2d-reset"), demo: $("#p2d-demo"),
    stages: $("#p2d-stages"), c1: $("#p2d-c1"), c2: $("#p2d-c2"), c1v: $("#p2d-c1v"), c2v: $("#p2d-c2v"),
    verdict: $("#p2d-verdict"), hint: $("#p2d-hint"), tip: $("#p2d-tip"),
  };
  const C = { ok: "#2f8a4a", bad: "#c8553a", corr: "#2f6fd0", draw: "#e08a1e", ink: "#1d1d1f" };
  const MAXLEN = 14, GRASP_R = 1.4, SNAP_R = 1.6, TAU = 0.05, EPS = 0.02, SHIFT = 1.5, SPEED = 30;
  const ASSET_V = "?v=r19";   // bump when tools/export_puzzle2d.py rewrites the sprites

  let SC, TW, TH, TOL, CLR, BW, HOME, img = {}, S = null, fieldOn = true, scale = 10, dpr = 1, noise = null;

  // ---------- scene ----------
  function load() {
    // scene.js (window.P2D_SCENE) lets the page work from file:// where fetch() of a local file is blocked
    const scene = window.P2D_SCENE ? Promise.resolve(window.P2D_SCENE) : fetch(DIR + "scene.json").then((r) => r.json());
    return scene.then((sc) => {
      SC = sc; [TW, TH] = sc.table_cm; TOL = sc.tolerance_cm; CLR = sc.clearance_cm; BW = sc.barrier_weight;
      HOME = { x: sc.home[0], y: sc.home[1] };
      const list = [["board", sc.board.sprite]].concat(sc.pieces.map((p) => ["p_" + p.id, p.sprite]));
      return Promise.all(list.map(([k, f]) => new Promise((res) => { const im = new Image(); im.onload = () => { img[k] = im; res(); }; im.onerror = res; im.src = DIR + f + ASSET_V; })));
    });
  }
  function reset() {
    S = {
      pieces: SC.pieces.map((p) => ({
        id: p.id, role: p.role, w: p.size[0], h: p.size[1], px: p.peg[0], py: p.peg[1], adj: p.adj,
        fit: p.fit ? { x: p.fit[0], y: p.fit[1] } : null, x: p.start[0], y: p.start[1],
        state: p.role === "anchor" ? "fitted" : "loose", flash: 0,
      })),
      tip: { ...HOME }, closed: false, held: null, stage: 0, busy: false,
      draw: null, last: null, corr: null, anim: null, done: false,
    };
    S.order = SC.stage_order.map((id) => S.pieces.find((p) => p.id === id));
    setVerdict(null); setChecks(null); renderStages();
    ui.hint.textContent = "Drag from the gripper to propose an action chunk.";
  }
  const pegOf = (p) => ({ x: p.x + p.px, y: p.y + p.py });
  const fitPeg = (p) => ({ x: p.fit.x + p.px, y: p.fit.y + p.py });
  const target = () => S.order[S.stage];
  function goal() {
    const t = target(); if (!t) return null;
    return S.held === t ? fitPeg(t) : pegOf(t);
  }
  function boxes() {   // non-target regions: every loose piece except the current target and the held piece
    const t = target();
    return S.pieces.filter((p) => p.state === "loose" && p !== t && p !== S.held)
      .map((p) => ({ x: p.x + p.w / 2, y: p.y + p.h / 2, hx: p.w / 2 - 0.6, hy: p.h / 2 - 0.6, p }));
  }
  function sdf(x, y, b) {
    const qx = Math.abs(x - b.x) - b.hx, qy = Math.abs(y - b.y) - b.hy;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  }
  function Phi(x, y, B) { let v = 0; for (const b of B) { const d = sdf(x, y, b); if (d < CLR) v += 0.5 * BW * ((CLR - d) / CLR) ** 2; } return v; }
  function V(x, y, G, B) { return 0.5 * ((x - G.x) ** 2 + (y - G.y) ** 2) / (TOL * TOL) + Phi(x, y, B); }

  // ---------- chunk selection (Eq. 3) ----------
  function evaluate(path) {
    if (!fieldOn) return { ok: true, kind: "nofield" };
    const G = goal(); if (!G) return { ok: true, kind: "nofield" };
    const s = path[0], e = path[path.length - 1];
    if (Math.hypot(s.x - G.x, s.y - G.y) < TOL) {
      // inside W_k the policy has full control; the field only checks that the chunk stays inside W_k:
      // a small overshoot is shifted back (bounded position shift), a larger one is rejected (new policy query)
      const out = Math.max(...path.map((q) => Math.hypot(q.x - G.x, q.y - G.y) - TOL));
      return out <= 0 ? { ok: true, kind: "workspace", out } : out <= SHIFT ? { ok: true, kind: "shift", out } : { ok: false, kind: "leave", out };
    }
    const B = boxes(), dV = V(e.x, e.y, G, B) - V(s.x, s.y, G, B);
    let maxPhi = 0, hit = null;
    for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < 4; k++) {
      const t = k / 4, x = path[i].x + (path[i + 1].x - path[i].x) * t, y = path[i].y + (path[i + 1].y - path[i].y) * t;
      const v = Phi(x, y, B); if (v > maxPhi) { maxPhi = v; hit = B.find((b) => sdf(x, y, b) < CLR) || hit; }
    }
    const bound = Math.max(EPS, Phi(s.x, s.y, B));
    const ok1 = dV <= TAU, ok2 = maxPhi <= bound;
    return { ok: ok1 && ok2, ok1, ok2, dV, maxPhi, bound, hit, kind: ok1 && ok2 ? "keep" : (ok2 ? "away" : "over") };
  }

  // ---------- field correction (Eq. 4): bounded descent toward the goal, around non-target regions ----------
  // It only brings the gripper into the policy workspace (stops at its edge); the grasp and the fit are left to the policy.
  function segClear(a, b, B) {
    const lim = Math.max(EPS, Phi(a.x, a.y, B), Phi(b.x, b.y, B)) + 1e-6;
    for (let i = 1; i <= 30; i++) { const t = i / 30; if (Phi(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, B) > lim) return false; }
    return true;
  }
  function route(p, G, B) {
    if (segClear(p, G, B)) return [];
    const nodes = [p, G];
    for (const b of B) for (const [u, v] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) {
      const q = { x: b.x + u * (b.hx + CLR + 1.4), y: b.y + v * (b.hy + CLR + 1.4) };
      if (q.x > 0.5 && q.x < TW - 0.5 && q.y > 0.5 && q.y < TH - 0.5 && Phi(q.x, q.y, B) <= EPS) nodes.push(q);
    }
    const n = nodes.length, dist = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = Array(n).fill(false);
    dist[0] = 0;
    for (;;) {
      let u = -1; for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === 1) break; done[u] = true;
      for (let v = 1; v < n; v++) if (!done[v]) {
        const d = dist[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].y - nodes[u].y);
        if (d < dist[v] && segClear(nodes[u], nodes[v], B)) { dist[v] = d; prev[v] = u; }
      }
    }
    if (dist[1] === Infinity) return null;
    const path = []; for (let v = prev[1]; v > 0; v = prev[v]) path.unshift(nodes[v]); return path;
  }
  function correction() {
    const G = goal(), B = boxes(), p0 = { ...S.tip }, wps = route(p0, G, B) || [];
    const pts = [p0]; let p = p0, budget = MAXLEN;
    for (const w of [...wps, G]) {
      const d = Math.hypot(w.x - p.x, w.y - p.y); if (d < 1e-3) continue;
      const stop = w === G ? Math.max(0, d - TOL * 0.8) : d;       // never past the workspace edge
      const step = Math.min(stop, budget); if (step < 1e-3) break;
      p = { x: p.x + (w.x - p.x) / d * step, y: p.y + (w.y - p.y) / d * step }; pts.push(p); budget -= step;
      if (budget <= 1e-3 || Math.hypot(p.x - G.x, p.y - G.y) <= TOL * 0.8 + 1e-3) break;
    }
    return densify(pts);
  }
  function densify(pts) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.4));
      for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
    }
    return out;
  }
  const lengthOf = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

  // ---------- executing a chunk; evidence; fitting ----------
  function execute(pts, then) {
    const L = lengthOf(pts);
    S.anim = { pts, L, t: 0, dur: Math.max(350, L / SPEED * 1000), then };
  }
  function moveTip(x, y) {
    S.tip.x = x; S.tip.y = y;
    if (S.held) { S.held.x = x - S.held.px; S.held.y = y - S.held.py; }
  }
  function afterChunk(byField) {
    if (byField) {           // a field correction never grasps or fits: the next chunk (the policy's) does
      const G = goal();
      if (G && Math.hypot(G.x - S.tip.x, G.y - S.tip.y) < TOL)
        setVerdict("contact", S.held ? "Correction complete at workspace boundary W_k: fine insertion is delegated to the policy (end on the board slot)."
                                     : "Correction complete at workspace boundary W_k: fine grasping is delegated to the policy (end on the handle).");
      S.busy = false; renderStages(); return;
    }
    if (!S.held) {
      const near = S.pieces.filter((p) => p.state === "loose").map((p) => ({ p, d: Math.hypot(pegOf(p).x - S.tip.x, pegOf(p).y - S.tip.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (near && near.d < GRASP_R) {
        S.held = near.p; near.p.state = "held"; S.closed = true; moveTip(pegOf(near.p).x, pegOf(near.p).y);
        if (near.p.role === "distractor") setVerdict("bad", "Failure mode (Field off): Grasped an out-of-task distractor piece. Click Release piece.");
        else if (near.p !== target()) setVerdict("bad", "Out-of-order grasp: This piece lacks an adjacent anchor. Release it and grasp the current stage target (next).");
        else setVerdict("ok", "Target grasped. Next stage: transport the piece to its assembly slot.");
      }
    } else if (S.held.fit) {
      const f = fitPeg(S.held);
      if (Math.hypot(f.x - S.tip.x, f.y - S.tip.y) < SNAP_R) {
        const fitted = S.pieces.filter((p) => p.state === "fitted").map((p) => p.id);
        if (!S.held.adj.some((id) => fitted.includes(id))) { setVerdict("bad", "Invalid assembly order: this piece requires an adjacent fitted piece."); }
        else { snap(S.held); return; }
      }
    }
    S.busy = false; renderStages();
  }
  function snap(p) {
    const from = { x: p.x, y: p.y };
    S.held = null; p.state = "snapping";
    S.snapAnim = { p, from, t: 0, dur: 380 };
    setVerdict("contact", "Within workspace W_k: the policy executes contact-rich insertion.");
  }
  function release() {
    if (!S.held || S.busy) return;
    S.held.state = "loose"; S.held = null; S.closed = false;
    setVerdict(null); renderStages();
  }

  // ---------- readouts ----------
  function setVerdict(kind, text) {
    ui.verdict.className = "p2d-verdict" + (kind ? " " + kind : "");
    ui.verdict.textContent = text || (fieldOn ? "Propose an action chunk to evaluate admissibility under Eq. 3." : "Field off (Base policy): chunks execute unconstrained without field evaluation.");
  }
  function setChecks(r) {
    const f = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
    if (!r || r.kind === "nofield") { ui.c1.className = ui.c2.className = "row"; ui.c1v.textContent = ui.c2v.textContent = "–"; return; }
    if (["workspace", "shift", "leave"].includes(r.kind)) {   // Eq. 3 is not applied inside W_k
      ui.c1.className = "row"; ui.c1v.textContent = "inside W: not checked";
      ui.c2.className = "row " + (r.kind === "leave" ? "bad" : "ok");
      ui.c2v.textContent = r.kind === "workspace" ? "stays in W" : `${r.out.toFixed(1)} cm out of W${r.kind === "shift" ? " → shift" : ""}`;
      return;
    }
    ui.c1.className = "row " + (r.ok1 ? "ok" : "bad"); ui.c2.className = "row " + (r.ok2 ? "ok" : "bad");
    ui.c1v.textContent = `${f(r.dV)} ≤ ${TAU.toFixed(2)}`; ui.c2v.textContent = `${r.maxPhi.toFixed(2)} ≤ ${r.bound.toFixed(2)}`;
  }
  function renderStages() {
    ui.stages.innerHTML = S.order.map((p, i) => {
      const st = p.state === "fitted" ? "done" : (i === S.stage ? "cur" : "");
      return `<span class="stg ${st}"><img src="${DIR}piece_${p.id}.webp${ASSET_V}" alt="">${st === "done" ? "<em>fitted</em>" : st === "cur" ? `<em>${S.held === p ? "bring" : "next"}</em>` : ""}</span>`;
    }).join("");
    ui.release.hidden = !(S.held && S.held !== target());   // only needed after grabbing the wrong piece
  }

  // ---------- drawing ----------
  function resize() {
    const w = cv.clientWidth; if (!w) return;      // not laid out yet; the ResizeObserver calls again
    dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width === Math.round(w * dpr) && noise) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(w * TH / TW * dpr); cv.style.height = w * TH / TW + "px";
    scale = cv.width / TW; noise = null;
  }
  const X = (x) => x * scale, Y = (y) => y * scale;
  let bg = null;
  function table(c2) {
    if (!cv.width || !cv.height) return;
    if (!noise) {
      noise = document.createElement("canvas"); noise.width = cv.width; noise.height = cv.height;
      const c = noise.getContext("2d"), g = c.createLinearGradient(0, 0, cv.width, cv.height);
      g.addColorStop(0, "#efeae2"); g.addColorStop(1, "#e6e0d6"); c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
      const id = c.getImageData(0, 0, cv.width, cv.height), d = id.data;
      for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      c.putImageData(id, 0, 0);
    }
    c2.drawImage(noise, 0, 0);
  }
  // ---------- field heatmap: V_z of the current stage on the whole table ----------
  // Log colour scale with fixed ends, so one legend serves every stage: V_z = 0 at the goal (deep blue) up to
  // V_z >= HMAX (red); the non-target bumps Phi_z show as warm rims around the other pieces.
  const HMAX = 100, HCELL = 0.4;
  const HSTOPS = [[0, [42, 85, 148]], [0.22, [95, 146, 211]], [0.45, [216, 230, 242]], [0.68, [242, 205, 128]], [0.85, [226, 137, 74]], [1, [188, 76, 59]]];
  function hcol(c) {
    c = Math.max(0, Math.min(1, c));
    for (let i = 1; i < HSTOPS.length; i++) if (c <= HSTOPS[i][0]) {
      const [a, ca] = HSTOPS[i - 1], [b, cb] = HSTOPS[i], u = (c - a) / (b - a);
      return ca.map((v, k) => Math.round(v + (cb[k] - v) * u));
    }
    return HSTOPS[HSTOPS.length - 1][1];
  }
  const hnorm = (v) => Math.log1p(Math.max(0, v)) / Math.log1p(HMAX);
  let heat = null;
  function heatmap(G, B) {
    const key = `${G.x.toFixed(2)},${G.y.toFixed(2)}|` + B.map((b) => `${b.x.toFixed(1)},${b.y.toFixed(1)}`).join(";");
    if (heat && heat.key === key) return heat.cv;
    const nx = Math.ceil(TW / HCELL), ny = Math.ceil(TH / HCELL);
    const c = heat ? heat.cv : document.createElement("canvas"); c.width = nx; c.height = ny;
    const g = c.getContext("2d"), id = g.createImageData(nx, ny), d = id.data;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 4, [r, gg, bb] = hcol(hnorm(V((i + 0.5) * HCELL, (j + 0.5) * HCELL, G, B)));
      d[k] = r; d[k + 1] = gg; d[k + 2] = bb; d[k + 3] = 255;
    }
    g.putImageData(id, 0, 0); heat = { key, cv: c }; return c;
  }
  function heatKey() {          // colour scale left of the canvas: high at the top, low (goal) at the bottom
    const el = $("#p2d-key"); if (!el) return;
    const stops = []; for (let k = 0; k <= 20; k++) { const [r, g, b] = hcol(1 - k / 20); stops.push(`rgb(${r},${g},${b}) ${k * 5}%`); }
    const ticks = [HMAX, 30, 10, 3, 1, 0].map((v) => `<span style="top:${((1 - hnorm(v)) * 100).toFixed(1)}%">${v === HMAX ? "\u2265" + v : v}</span>`).join("");
    el.innerHTML = `<div class="kt">Field <i>V</i><sub>z</sub></div><div class="kh">high</div>` +
      `<div class="kbar" style="background:linear-gradient(${stops.join(",")})">${ticks}</div><div class="kl">low</div><div class="kl">goal</div>`;
  }
  function drawPiece(p, alpha, lifted) {
    const im = img["p_" + p.id]; if (!im) return;
    ctx.save(); if (alpha != null) ctx.globalAlpha = alpha;
    ctx.shadowColor = lifted ? "rgba(0,0,0,.35)" : "rgba(0,0,0,.22)";
    ctx.shadowBlur = (lifted ? 14 : 4) * dpr; ctx.shadowOffsetX = (lifted ? 6 : 1) * dpr; ctx.shadowOffsetY = (lifted ? 9 : 2) * dpr;
    ctx.drawImage(im, X(p.x), Y(p.y), p.w * scale, p.h * scale); ctx.restore();
  }
  function line(pts, col, w, dash, upto) {
    if (!pts || pts.length < 2) return;
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = w * dpr; ctx.lineCap = ctx.lineJoin = "round"; if (dash) ctx.setLineDash(dash.map((v) => v * dpr));
    ctx.shadowColor = "rgba(255,255,255,.9)"; ctx.shadowBlur = 3 * dpr;
    const n = upto == null ? pts.length : Math.max(2, upto);
    ctx.beginPath(); ctx.moveTo(X(pts[0].x), Y(pts[0].y)); for (let i = 1; i < n && i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y)); ctx.stroke(); ctx.restore();
  }
  function arrowHead(pts, col) {
    if (!pts || pts.length < 2) return;
    const a = pts[pts.length - 2], b = pts[pts.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x), s = 0.9 * scale;
    ctx.save(); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(X(b.x), Y(b.y));
    ctx.lineTo(X(b.x) - s * Math.cos(ang - 0.45), Y(b.y) - s * Math.sin(ang - 0.45)); ctx.lineTo(X(b.x) - s * Math.cos(ang + 0.45), Y(b.y) - s * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function gripper(x, y, closed) {
    const gx = X(x), gy = Y(y), s = scale, gap = (closed ? 0.55 : 1.6) * s;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 8 * dpr; ctx.shadowOffsetY = 4 * dpr;
    ctx.fillStyle = "#26292f";
    ctx.beginPath(); ctx.roundRect(gx - gap - 0.55 * s, gy - 1.4 * s, 0.55 * s, 2.6 * s, 0.2 * s); ctx.fill();      // left finger
    ctx.beginPath(); ctx.roundRect(gx + gap, gy - 1.4 * s, 0.55 * s, 2.6 * s, 0.2 * s); ctx.fill();                 // right finger
    ctx.beginPath(); ctx.roundRect(gx - 2.6 * s, gy + 1.2 * s, 5.2 * s, 0.9 * s, 0.3 * s); ctx.fill();              // palm
    ctx.beginPath(); ctx.roundRect(gx - 0.8 * s, gy + 2.1 * s, 1.6 * s, 2.2 * s, 0.3 * s); ctx.fill();              // wrist
    ctx.restore();
    ctx.save(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(gx, gy, 0.28 * s, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  // first-visit demo: a finger drags a dashed chunk from the gripper toward the next handle, until the first drag
  let touched = false;
  function ghost() {
    const t = target(); if (!t) return;
    const a = S.tip, pg = pegOf(t), d = Math.hypot(pg.x - a.x, pg.y - a.y), L = Math.min(d, MAXLEN * 0.85);
    const b = { x: a.x + (pg.x - a.x) * L / d, y: a.y + (pg.y - a.y) * L / d };
    const ph = (performance.now() % 2600) / 2600, f = Math.min(1, Math.max(0, (ph - 0.12) / 0.6));
    const e = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    const alpha = ph > 0.85 ? 1 - (ph - 0.85) / 0.15 : 1;
    ctx.save(); ctx.globalAlpha = alpha;
    if (f > 0) { ctx.strokeStyle = C.draw; ctx.lineWidth = 2.6 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(e.x), Y(e.y)); ctx.stroke(); ctx.setLineDash([]); }
    const r = (0.75 + 0.12 * Math.sin(ph * Math.PI * 4)) * scale;
    ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.strokeStyle = C.draw; ctx.lineWidth = 2.4 * dpr;
    ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = `700 ${1.25 * scale}px Inter, sans-serif`; ctx.textAlign = "center"; ctx.lineWidth = 4 * dpr; ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.globalAlpha = 1; ctx.textAlign = "right";
    ctx.strokeText("Drag from here →", X(a.x - 2.4), Y(a.y + 0.5)); ctx.fillStyle = C.draw; ctx.fillText("Drag from here →", X(a.x - 2.4), Y(a.y + 0.5));
    ctx.restore();
  }
  function draw() {
    if (!S) return;
    // table + the current stage's field V_z, cached as one full-size layer (rebuilt only when the field changes)
    const Gh = fieldOn && !S.done ? goal() : null, hc = Gh ? heatmap(Gh, boxes()) : null;
    const bkey = (hc ? heat.key : "-") + "|" + cv.width + "x" + cv.height;
    if (!bg || bg.key !== bkey) {
      const c = bg ? bg.cv : document.createElement("canvas"); c.width = cv.width; c.height = cv.height;
      const g = c.getContext("2d"); table(g);
      if (hc) { g.save(); g.globalAlpha = 0.62; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
        g.drawImage(hc, 0, 0, Math.ceil(TW / HCELL) * HCELL * scale, Math.ceil(TH / HCELL) * HCELL * scale); g.restore(); }
      bg = { key: bkey, cv: c };
    }
    ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(bg.cv, 0, 0);
    // board: where the tiger is assembled
    const b = SC.board;
    ctx.save(); ctx.globalAlpha = 0.13; ctx.drawImage(img.board, X(b.pos[0]), Y(b.pos[1]), b.size[0] * scale, b.size[1] * scale); ctx.restore();
    if (!S.done) { ctx.save(); ctx.font = `600 ${1.1 * scale}px Inter, sans-serif`; ctx.fillStyle = "rgba(60,66,78,.55)"; ctx.textAlign = "center";
      ctx.fillText("assembly", X(b.pos[0] + b.size[0] / 2), Y(b.pos[1] + b.size[1] + 1.6)); ctx.restore(); }
    const t = target(), G = goal(), B = fieldOn && t ? boxes() : [];
    // field: non-target regions (red) and the stage goal (blue well, policy workspace)
    B.forEach((r) => {
      const hot = S.last && !S.last.ok && S.last.hit && S.last.hit.p === r.p;
      ctx.save(); ctx.fillStyle = hot ? "rgba(200,85,58,.24)" : "rgba(200,85,58,.08)";
      ctx.strokeStyle = hot ? "rgba(200,85,58,.9)" : "rgba(200,85,58,.45)"; ctx.lineWidth = (hot ? 2.2 : 1.3) * dpr;
      ctx.beginPath(); ctx.roundRect(X(r.x - r.hx - CLR), Y(r.y - r.hy - CLR), (2 * r.hx + 2 * CLR) * scale, (2 * r.hy + 2 * CLR) * scale, 0.8 * scale);
      ctx.fill(); ctx.stroke(); ctx.restore();
    });
    // pieces
    S.pieces.filter((p) => p.state === "fitted" && p !== (S.snapAnim && S.snapAnim.p)).forEach((p) => drawPiece(p));
    if (fieldOn && t && S.held === t) drawPiece({ ...t, x: t.fit.x, y: t.fit.y }, 0.28);      // where the held piece goes
    S.pieces.filter((p) => p.state === "loose").forEach((p) => drawPiece(p));
    if (fieldOn && G) {
      const r = TOL * scale, gr = ctx.createRadialGradient(X(G.x), Y(G.y), 0, X(G.x), Y(G.y), r);
      gr.addColorStop(0, "rgba(47,111,208,.35)"); gr.addColorStop(1, "rgba(47,111,208,0)");
      ctx.save(); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(X(G.x), Y(G.y), r, 0, Math.PI * 2); ctx.fill();
      ctx.setLineDash([6 * dpr, 5 * dpr]); ctx.strokeStyle = "rgba(47,111,208,.85)"; ctx.lineWidth = 1.8 * dpr; ctx.stroke(); ctx.restore();
      if (S.held !== t) { // label the next piece
        const pg = pegOf(t); ctx.save(); ctx.font = `600 ${1.15 * scale}px Inter, sans-serif`; ctx.fillStyle = C.corr; ctx.textAlign = "center";
        ctx.fillText("next", X(pg.x), Y(pg.y - TOL - 0.4)); ctx.restore();
      }
    }
    // chunks
    if (S.last) {
      if (S.last.ok) line(S.last.path, C.ok, 2.6); else { line(S.last.path, C.bad, 2.4, [7, 5]); const e = S.last.path[S.last.path.length - 1], s = 0.7 * scale;
        ctx.save(); ctx.strokeStyle = C.bad; ctx.lineWidth = 2.6 * dpr; ctx.beginPath(); ctx.moveTo(X(e.x) - s, Y(e.y) - s); ctx.lineTo(X(e.x) + s, Y(e.y) + s); ctx.moveTo(X(e.x) + s, Y(e.y) - s); ctx.lineTo(X(e.x) - s, Y(e.y) + s); ctx.stroke(); ctx.restore(); }
    }
    if (S.corr) { line(S.corr, C.corr, 3); arrowHead(S.corr, C.corr); }
    if (S.draw) { line(S.draw, C.draw, 2.6, [6, 4]); arrowHead(S.draw, C.draw);
      const L = lengthOf(S.draw), e = S.draw[S.draw.length - 1];
      ctx.save(); ctx.font = `600 ${1.0 * scale}px Inter, sans-serif`; ctx.fillStyle = C.draw; ctx.fillText(`${L.toFixed(0)} / ${MAXLEN} cm`, X(e.x) + 0.8 * scale, Y(e.y) - 0.8 * scale); ctx.restore(); }
    if (S.snapAnim) drawPiece(S.snapAnim.p, null, false);
    if (!touched && !S.busy && !S.done && !S.draw) ghost();
    if (S.held) drawPiece(S.held, null, true);
    gripper(S.tip.x, S.tip.y, S.closed);
    if (!S.draw && !S.busy && !S.done) { // a soft pulse on the gripper invites the first drag
      const k = (performance.now() / 900) % 1; ctx.save(); ctx.strokeStyle = `rgba(224,138,30,${0.7 * (1 - k)})`; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(X(S.tip.x), Y(S.tip.y), (1.2 + 2.2 * k) * scale, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }

  // ---------- loop ----------
  let lastT = 0, onScreen = true;     // draw only while the canvas is (nearly) visible
  if (window.IntersectionObserver) new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; }, { rootMargin: "100px 0px" }).observe(cv);
  function frame(ts) {
    const dt = lastT ? Math.min(50, ts - lastT) : 16; lastT = ts;
    if (S && S.anim) {
      const a = S.anim; a.t += dt; const f = Math.min(1, a.t / a.dur), along = f * a.L;
      let acc = 0, i = 1; while (i < a.pts.length) { const d = Math.hypot(a.pts[i].x - a.pts[i - 1].x, a.pts[i].y - a.pts[i - 1].y); if (acc + d >= along) break; acc += d; i++; }
      if (i >= a.pts.length) moveTip(a.pts[a.pts.length - 1].x, a.pts[a.pts.length - 1].y);
      else { const p = a.pts[i - 1], q = a.pts[i], d = Math.hypot(q.x - p.x, q.y - p.y) || 1, u = (along - acc) / d; moveTip(p.x + (q.x - p.x) * u, p.y + (q.y - p.y) * u); }
      if (f >= 1) { const then = a.then; S.anim = null; then && then(); }
    }
    if (S && S.snapAnim) {
      const s = S.snapAnim; s.t += dt; const f = Math.min(1, s.t / s.dur), e = 1 - Math.pow(1 - f, 3);
      s.p.x = s.from.x + (s.p.fit.x - s.from.x) * e; s.p.y = s.from.y + (s.p.fit.y - s.from.y) * e; S.tip.x = s.p.x + s.p.px; S.tip.y = s.p.y + s.p.py;
      if (f >= 1) {
        s.p.state = "fitted"; S.closed = false; S.snapAnim = null; S.stage += 1; S.busy = false; S.last = null; S.corr = null;
        if (S.stage >= S.order.length) { S.done = true; setVerdict("ok", "Task complete: all puzzle stages succeeded."); ui.hint.textContent = "Click Reset to run another trial."; }
        else setVerdict("ok", "Piece fitted. Measured evidence advances the field state to the next stage without VLM queries.");
        renderStages();
      }
    }
    if (cv.width && (onScreen || S && (S.anim || S.snapAnim))) draw(); requestAnimationFrame(frame);
  }

  // ---------- input ----------
  const wpos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * TW, y: (e.clientY - r.top) / r.height * TH }; };
  function extend(p) {
    const pts = S.draw, last = pts[pts.length - 1], d = Math.hypot(p.x - last.x, p.y - last.y);
    if (d < 0.3) return;
    const L = lengthOf(pts); if (L >= MAXLEN) return;
    const k = Math.min(1, (MAXLEN - L) / d);
    pts.push({ x: Math.max(0.3, Math.min(TW - 0.3, last.x + (p.x - last.x) * k)), y: Math.max(0.3, Math.min(TH - 0.3, last.y + (p.y - last.y) * k)) });
  }
  cv.addEventListener("pointerdown", (e) => {
    if (demo.on) stopDemo("Manual policy control active. Click Simulate policy to resume.");
    if (S.busy || S.done) return;
    touched = true;
    S.draw = [{ ...S.tip }]; S.last = null; S.corr = null; extend(wpos(e));
    cv.setPointerCapture(e.pointerId); ui.hint.textContent = "Release to evaluate the proposed chunk.";
  });
  // hover readout: the field at the cursor (or at the end of the chunk being drawn)
  function probe(e) {
    const el = ui.tip; if (!el) return;
    const G = goal();
    if (!e || !S || S.done || !G) { el.hidden = true; return; }
    const r = cv.getBoundingClientRect();
    const q = S.draw ? S.draw[S.draw.length - 1] : wpos(e);
    const px = q.x / TW * r.width, py = q.y / TH * r.height;
    const f = (v) => (v < 0 ? "\u2212" : "") + Math.abs(v).toFixed(2);
    if (!fieldOn) {
      el.innerHTML = `<b>Field off</b><span>every chunk runs as drawn</span>`;
    } else {
      const B = boxes(), v = V(q.x, q.y, G, B), ph = Phi(q.x, q.y, B), dV = v - V(S.tip.x, S.tip.y, G, B);
      const inWs = Math.hypot(q.x - G.x, q.y - G.y) < TOL, ok = dV <= TAU, okPh = ph <= Math.max(EPS, Phi(S.tip.x, S.tip.y, B));
      const where = inWs ? `<em class="ws">policy workspace</em>` : ph > 0 ? `<em class="bad">non-target region</em>` : "";
      el.innerHTML = `${where}<div><i>V</i><sub>z</sub><span>${f(v)}</span></div>` +
        `<div class="${okPh ? "ok" : "bad"}"><i>\u03a6</i><sub>z</sub><span>${f(ph)} ${okPh ? "\u2713" : "\u2717"}</span></div>` +
        `<div class="${ok ? "ok" : "bad"}"><label>\u0394<i>V</i> from gripper</label><span>${dV > 0 ? "+" : ""}${f(dV)} ${ok ? "\u2713" : "\u2717"}</span></div>`;
    }
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.min(r.width - w - 6, px + 14) + "px";
    el.style.top = Math.max(6, py - h - 12) + "px";
  }
  cv.addEventListener("pointermove", (e) => { if (S.draw) extend(wpos(e)); if (e.pointerType === "mouse" || S.draw) probe(e); });
  cv.addEventListener("pointerleave", () => { if (!S.draw) probe(null); });
  const up = () => {
    if (!S.draw) return;
    const path = densify(S.draw); S.draw = null; probe(null);
    if (lengthOf(path) < 0.8) { ui.hint.textContent = "Drag from the gripper to propose an action chunk."; return; }
    ui.hint.textContent = demo.on ? "Simulating a policy. Draw a chunk at any time to intervene." : "Drag from the gripper to propose the next action chunk.";
    S.busy = true;
    const r = evaluate(path); r.path = path; S.last = r; setChecks(r);
    if (r.kind === "leave") {
      setVerdict("bad", "Rejected: trajectory exits workspace W_k beyond shift tolerance, triggering a new policy query.");
      S.busy = false; return;
    }
    if (r.kind === "shift") {
      const G = goal(), R = TOL * 0.97;
      S.corr = path.map((q) => { const d = Math.hypot(q.x - G.x, q.y - G.y); return d <= R ? q : { x: G.x + (q.x - G.x) * R / d, y: G.y + (q.y - G.y) * R / d }; });
      setVerdict("contact", "Minor workspace boundary excursion: repaired via bounded position shift back into W_k.");
      execute(S.corr, afterChunk);
    } else if (r.ok) {
      setVerdict(r.kind === "workspace" ? "contact" : "ok",
        r.kind === "workspace" ? "Inside workspace W_k: policy retains unconstrained control while remaining within W_k." : r.kind === "nofield" ? "Executed unconstrained (Field off)." : "Accepted (Eq. 3): chunk reduces potential V_z and avoids non-target barriers.");
      execute(path, afterChunk);
    } else {
      setVerdict("bad", r.kind === "over" ? "Rejected (Eq. 3): trajectory violates non-target barrier \u03a6_z. Replaced by gradient-based field correction." : "Rejected (Eq. 3): insufficient progress (\u0394V > \u03c4). Replaced by gradient-based field correction.");
      setTimeout(() => { S.corr = correction(); execute(S.corr, () => afterChunk(true)); }, 550);
    }
  };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  ui.seg.forEach((b) => b.addEventListener("click", () => {
    fieldOn = b.dataset.field === "on"; ui.seg.forEach((x) => x.classList.toggle("on", x === b));
    root.classList.toggle("nofield", !fieldOn); reset();
  }));
  ui.release.addEventListener("click", release);
  ui.reset.addEventListener("click", () => { stopDemo(); reset(); touched = false; });   // show the drag hint again
  ui.demo.addEventListener("click", () => (demo.on ? stopDemo("Simulation paused. Draw a chunk to intervene, or click Simulate policy to resume.") : startDemo()));

  // ---------- demo policy ----------
  // A scripted stand-in for the frozen policy. It mostly moves toward the goal but now and then drifts back or
  // toward a piece of another puzzle, overshoots inside the workspace, or leaves it, so every field response shows
  // up: accepted, rejected + correction, bounded shift, rejected + new query, grasp and fit. It starts from any state
  // and the visitor can take over at any time (draw a chunk) and hand back (press Auto-play).
  const demo = { on: false, timer: 0, idle: 0, out: 0, visits: 0, wsKey: null, wsStep: 0 };
  const OUT_PLAN = ["go", "lure", "go", "away", "go", "go", "lure", "go"];
  function startDemo() {
    if (S.done) reset();
    demo.on = true; touched = true; demo.idle = 0; ui.demo.classList.add("on"); ui.demo.textContent = "❚❚ Pause simulation";
    ui.hint.textContent = "Simulating a policy. Draw a chunk at any time to intervene.";
    clearTimeout(demo.timer); demo.timer = setTimeout(demoTick, 200);
  }
  function stopDemo(msg) {
    if (!demo.on) return;
    demo.on = false; clearTimeout(demo.timer); ui.demo.classList.remove("on"); ui.demo.textContent = "▶ Simulate policy";
    if (msg) ui.hint.textContent = msg;
  }
  function demoTick() {
    if (!demo.on) return;
    if (S.done) { stopDemo("Simulation complete. Click Reset to run again."); return; }
    if (S.busy || S.anim || S.snapAnim || S.draw) { demo.idle = 0; demo.timer = setTimeout(demoTick, 60); return; }
    if (!demo.idle) demo.idle = performance.now();
    if (performance.now() - demo.idle < 1100) { demo.timer = setTimeout(demoTick, 60); return; }   // time to read the verdict
    demo.idle = 0;
    if (S.held && !S.held.fit) {          // field off: the policy grabbed a piece of another puzzle
      stopDemo("Without the task field, the policy grasped an incompatible distractor piece. Click Release piece or Reset."); return;
    }
    const pts = demoChunk(); if (!pts) { stopDemo(); return; }
    S.last = null; S.corr = null; S.draw = [{ ...S.tip }]; pts.forEach((p) => extend(p)); up();
    demo.timer = setTimeout(demoTick, 60);
  }
  function demoChunk() {
    const G = goal(); if (!G) return null;
    const t = S.tip, dx = G.x - t.x, dy = G.y - t.y, d = Math.hypot(dx, dy), ux = dx / (d || 1), uy = dy / (d || 1);
    const at = (k) => ({ x: t.x + ux * k, y: t.y + uy * k });
    const key = (S.held ? "fit:" : "peg:") + target().id;
    if (d < TOL) {                         // inside the workspace
      if (demo.wsKey !== key) { demo.wsKey = key; demo.wsStep = 0; demo.visits += 1; }
      const extra = [["shift"], ["leave"], ["shift", "leave"], []][(demo.visits - 1) % 4];
      const what = extra[demo.wsStep++] || "precise";
      const out = what === "shift" ? TOL - d + 0.8 : what === "leave" ? 8 : 0;
      return what === "precise" ? [{ ...G }] : [{ x: t.x - ux * out, y: t.y - uy * out }];   // back out, away from the goal
    }
    const plan = OUT_PLAN[demo.out++ % OUT_PLAN.length];
    if (plan === "lure" || (!fieldOn && !S.held)) {      // drift toward a piece of another puzzle
      const lure = S.pieces.filter((p) => p.role === "distractor" && p.state === "loose")
        .map((p) => ({ q: pegOf(p), dd: Math.hypot(pegOf(p).x - t.x, pegOf(p).y - t.y) })).sort((a, b) => a.dd - b.dd)[0];
      if (lure && !S.held) return [lure.dd <= MAXLEN ? lure.q : { x: t.x + (lure.q.x - t.x) / lure.dd * 12, y: t.y + (lure.q.y - t.y) / lure.dd * 12 }];
      if (lure) return [{ x: t.x + (lure.q.x - t.x) / lure.dd * 8, y: t.y + (lure.q.y - t.y) / lure.dd * 8 }];
    }
    if (plan === "away") return [at(-7)];
    return [d <= MAXLEN + TOL * 0.4 ? at(d - TOL * 0.5) : at(12)];       // progress; enter the workspace when close
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv); else window.addEventListener("resize", resize);

  // test hook: send a chunk programmatically (points in cm, starting anywhere; the tip is prepended)
  root._chunk = (pts) => new Promise((res) => {
    if (S.busy) return res(null);
    S.draw = [{ ...S.tip }]; pts.forEach((p) => extend(p)); up();
    const wait = () => (S.busy || S.anim || S.snapAnim ? setTimeout(wait, 30) : res({ ok: S.last ? S.last.ok : null, kind: S.last && S.last.kind, held: S.held && S.held.id, stage: S.stage, tip: { ...S.tip } }));
    wait();
  });
  root._state = () => ({ stage: S.stage, held: S.held && S.held.id, tip: { ...S.tip }, done: S.done,
    pegs: Object.fromEntries(S.pieces.map((p) => [p.id, pegOf(p)])), fits: Object.fromEntries(S.pieces.filter((p) => p.fit).map((p) => [p.id, fitPeg(p)])) });

  load().then(() => { resize(); reset(); heatKey(); requestAnimationFrame(frame); });
})();
