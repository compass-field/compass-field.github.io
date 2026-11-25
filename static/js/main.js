// COMPASS project page: demo video, task tabs, charts.
(function () {
  "use strict";

  const C = {
    // method colors, text, grid and axis exactly as in the paper's figures (Figs. 4, 6, 7; read from the PDF)
    base: "#BC4C3B", vox: "#5FA864", online: "#A8C6EC", way: "#5F92D3", ours: "#2A5594", lang: "#D9A441",
    grid: "#E3E6EA", axis: "#8A9099", ink: "#2B2F36", muted: "#5B6270",
  };
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  const txt = (parent, x, y, s, attrs = {}) => {
    const t = el("text", { x, y, ...attrs }, parent);
    t.textContent = s;
    return t;
  };

  // ---------- demo video: paused on its cover, plays with sound ----------
  const demo = document.getElementById("demo");
  const bigplay = document.getElementById("bigplay");
  // With data-youtube="<video id>" on the frame, the click swaps the cover for the YouTube player (loaded only then).
  const yt = demo && demo.parentElement.dataset.youtube;
  if (demo && bigplay && yt) {
    bigplay.addEventListener("click", () => {
      const f = document.createElement("iframe");
      f.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(yt) + "?autoplay=1&rel=0&modestbranding=1&playsinline=1";
      f.title = "COMPASS demo video";
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.allowFullscreen = true;
      f.className = "yt";
      demo.parentElement.replaceChildren(f);
    });
  } else if (demo && bigplay) {
    demo.muted = false;
    demo.volume = 1;
    const frame = demo.parentElement;
    bigplay.addEventListener("click", () => { demo.muted = false; demo.play().catch(() => {}); });
    demo.addEventListener("play", () => { demo.controls = true; frame.classList.add("playing"); });
    demo.addEventListener("pause", () => frame.classList.remove("playing"));
    demo.addEventListener("ended", () => frame.classList.remove("playing"));
  }

  // ---------- lazy videos: play only while visible ----------
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting) { v.preload = "auto"; v.play().catch(() => {}); }
      else v.pause();
    }
  }, { threshold: 0.35 });
  document.querySelectorAll("video[data-lazy]").forEach((v) => io.observe(v));

  // ---------- rollouts: base vs COMPASS per layout; speed per task, draggable progress per video ----------
  const fmt = (t) => (isFinite(t) ? (t >= 60 ? Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0") : t.toFixed(1) + " s") : "–");
  document.querySelectorAll(".ro-task").forEach((task) => {
    const vids = [...task.querySelectorAll(".ro-vid > video")];   // main clips (the close-up insets follow them)
    let rate = 1;          // clips start at real speed; the speed buttons change it per task
    task._held = false;    // true once the visitor pauses this task (then scrolling back does not restart it)
    const paint = (v) => {
      const box = v.parentElement, d = v.duration, f = d ? v.currentTime / d : 0;
      box.querySelector(".ro-time").textContent = fmt(v.currentTime) + (d ? " / " + fmt(d) : "");
      box.querySelector(".ro-fill").style.width = f * 100 + "%";
      box.querySelector(".ro-knob").style.left = f * 100 + "%";
    };
    const setRate = (r) => {
      rate = r;
      vids.forEach((v) => { v.playbackRate = r; v.parentElement.querySelector(".ro-rt").textContent = r === 1 ? "real-time" : (r === 0.5 ? "½" : r) + "× speed"; });
      task.querySelectorAll("[data-rate]").forEach((b) => b.classList.toggle("on", +b.dataset.rate === r));
    };
    task.querySelectorAll("[data-rate]").forEach((b) => b.addEventListener("click", () => setRate(+b.dataset.rate)));
    vids.forEach((v) => {
      ["timeupdate", "seeked", "loadedmetadata"].forEach((e) => v.addEventListener(e, () => paint(v)));
      v.addEventListener("play", () => { v.playbackRate = rate; });
      v.addEventListener("ended", () => v.parentElement.classList.add("done"));
      v.addEventListener("click", () => { if (v.paused) v.play().catch(() => {}); else { v.pause(); task._held = true; } });
      // synchronized close-up inset (earphone, puzzle): same time window as the clip, follows play / pause / seek /
      // speed; a click enlarges it to the whole cell and a second click shrinks it back
      const pip = v.parentElement.querySelector(".ro-pip"), pv = pip && pip.querySelector("video");
      if (pv) {
        const follow = (force) => {
          if (pv.readyState < 1) return;
          pv.playbackRate = v.playbackRate;
          const t = Math.min(v.currentTime, (pv.duration || 1e9) - 0.05);
          if (force || Math.abs(pv.currentTime - t) > 0.25 + 0.05 * v.playbackRate) pv.currentTime = t;
        };
        v.addEventListener("play", () => { follow(true); pv.play().catch(() => {}); });
        ["pause", "ended"].forEach((e) => v.addEventListener(e, () => { pv.pause(); follow(true); }));
        v.addEventListener("seeked", () => follow(true));
        v.addEventListener("timeupdate", () => follow(false));
        v.addEventListener("ratechange", () => { pv.playbackRate = v.playbackRate; });
        pv.addEventListener("loadedmetadata", () => { follow(true); if (!v.paused) pv.play().catch(() => {}); });
        const toggle = (e) => { e.stopPropagation(); const big = v.parentElement.classList.toggle("big");
          pip.setAttribute("aria-label", big ? "Shrink the close-up view" : "Enlarge the close-up view"); };
        pip.addEventListener("click", toggle);
        pip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); } });
      }
      // draggable progress bar
      const bar = v.parentElement.querySelector(".ro-bar");
      const seekTo = (e) => {
        const r = bar.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        if (v.duration) { v.currentTime = f * v.duration; v.parentElement.classList.toggle("done", f >= 1); paint(v); }
      };
      let drag = false, wasPlaying = false;
      bar.addEventListener("pointerdown", (e) => {
        e.stopPropagation(); drag = true; wasPlaying = !v.paused; v.pause();
        bar.setPointerCapture(e.pointerId); bar.classList.add("drag"); seekTo(e);
      });
      bar.addEventListener("pointermove", (e) => { if (drag) seekTo(e); });
      const end = () => { if (!drag) return; drag = false; bar.classList.remove("drag"); if (wasPlaying) v.play().catch(() => {}); };
      bar.addEventListener("pointerup", end); bar.addEventListener("pointercancel", end);
      bar.addEventListener("click", (e) => e.stopPropagation());
      bar.addEventListener("keydown", (e) => {
        if (!v.duration || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault(); v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + (e.key === "ArrowRight" ? 5 : -5)));
      });
    });
    const btnPlay = task.querySelector('[data-act="play"]');
    const playing = () => vids.some((v) => !v.paused && !v.ended);
    const sync = () => { btnPlay.textContent = playing() ? "Pause all" : "Play all"; };
    vids.forEach((v) => ["play", "pause", "ended"].forEach((e) => v.addEventListener(e, sync)));
    btnPlay.addEventListener("click", () => {
      if (playing()) { vids.forEach((v) => v.pause()); task._held = true; return; }
      task._held = false;
      vids.forEach((v) => { if (v.ended) { v.currentTime = 0; v.parentElement.classList.remove("done"); } v.playbackRate = rate; v.play().catch(() => {}); });
    });
    task.querySelector('[data-act="reset"]').addEventListener("click", () => {
      vids.forEach((v) => { v.pause(); v.currentTime = 0; v.parentElement.classList.remove("done"); paint(v); });
      task._held = true;
    });
    // autoplay when the task scrolls into view (see the observers below)
    task._auto = () => {
      if (task._held) return;
      vids.forEach((v) => { if (!v.ended) { v.playbackRate = rate; v.play().catch(() => {}); } });
    };
  });
  // Load a task's clips only when it comes near the viewport (src is in data-src), and pause them once it is
  // scrolled out of view, so the 16 clips never decode at the same time as the demo video or each other.
  const roLoad = (task) => task.querySelectorAll("video[data-src]").forEach((v) => {
    v.src = v.dataset.src; v.removeAttribute("data-src"); v.preload = "metadata";
  });
  if ("IntersectionObserver" in window) {
    const near = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { roLoad(e.target); near.unobserve(e.target); } }),
      { rootMargin: "600px 0px" });
    const seen = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { roLoad(e.target); e.target._auto(); }
      else e.target.querySelectorAll("video").forEach((v) => v.pause());
    }), { rootMargin: "-30% 0px -30% 0px" });   // "in view" = overlaps the middle 40% of the viewport
    document.querySelectorAll(".ro-task").forEach((t) => { near.observe(t); seen.observe(t); });
  } else document.querySelectorAll(".ro-task").forEach(roLoad);

  // ---------- KaTeX ----------
  if (window.katex) {
    document.querySelectorAll("[data-tex]").forEach((n) =>
      katex.render(n.dataset.tex, n, { throwOnError: false }));
  }

  // ---------- count-up numbers ----------
  const cio = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      cio.unobserve(e.target);
      const n = e.target, to = parseFloat(n.dataset.count), suf = n.dataset.suffix || "";
      const dec = (n.dataset.count.split(".")[1] || "").length, t0 = performance.now(), D = 1100;
      const step = (t) => {
        const f = Math.max(0, Math.min(1, (t - t0) / D)), v = to * (1 - Math.pow(1 - f, 3));
        n.textContent = v.toFixed(dec) + suf;
        if (f < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll("[data-count]").forEach((n) => cio.observe(n));


  // ---------- legends ----------
  // "COMPASS" is typeset as in the paper: Times, "C" + "OMPASS" at 0.8 size, name color #3F78C0 (style.css .sc)
  const nameHTML = (s) => s.replace(/COMPASS/g, '<span class="sc">C<small>OMPASS</small></span>');
  function legend(id, items, kind = "box") {
    const L = document.getElementById(id);
    if (!L) return;
    L.innerHTML = items.map(([name, color, cls]) =>
      `<span><i class="${cls || ""}" style="background:${color}"></i><em class="lgn">${nameHTML(name)}</em></span>`).join("");
  }

  // ---------- grouped bar chart ----------
  function bars(container, groups, series, opts) {
    const W = opts.width || 860, H = opts.height || 300;
    const m = { l: 40, r: 8, t: 22, b: 34 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label || "" });
    container.innerHTML = "";
    container.appendChild(svg);
    const gAxis = el("g", {}, svg), gBars = el("g", {}, svg);
    const ih = H - m.t - m.b, iw = W - m.l - m.r;
    const gw = iw / groups.length, pad = gw * 0.16;
    const bw = (gw - 2 * pad) / series.length;
    const rects = [];
    groups.forEach((g, gi) => {
      txt(gAxis, m.l + gi * gw + gw / 2, H - 10, g, { "text-anchor": "middle", "font-size": 14, fill: C.ink, "font-weight": 600 });
      series.forEach((s, si) => {
        const x = m.l + gi * gw + pad + si * bw;
        const r = el("rect", { x: x + 1.5, width: bw - 3, rx: 2.5, fill: s.color, class: "bar-rect" }, gBars);
        const v = txt(gBars, x + bw / 2, 0, "", {
          "text-anchor": "middle", "font-size": bw > 26 ? 12.5 : 11, class: "val",
          fill: s.key === "ours" ? C.ours : C.muted, "font-weight": s.key === "ours" ? 700 : 500,
        });
        rects.push({ r, v, gi, si });
      });
    });
    function update(metric) {
      const max = metric.max;
      gAxis.querySelectorAll(".tick").forEach((n) => n.remove());
      metric.ticks.forEach((tk) => {
        const y = m.t + ih - ih * tk / max;
        el("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: tk === 0 ? C.axis : C.grid, class: "tick" }, gAxis);
        txt(gAxis, m.l - 8, y + 4, String(tk), { "text-anchor": "end", "font-size": 12, fill: C.muted, class: "tick" });
      });
      rects.forEach(({ r, v, gi, si }) => {
        const val = metric.data[series[si].key][gi];
        const h = ih * val / max;
        r.setAttribute("y", m.t + ih - h);
        r.setAttribute("height", Math.max(h, 0.0001));
        v.setAttribute("y", m.t + ih - h - 5);
        v.textContent = metric.fmt ? metric.fmt(val) : val;
      });
    }
    return update;
  }

  // Main results (paper Fig. 4).
  const MAIN_SERIES = [
    { key: "base", name: "Base policy", color: C.base },
    { key: "vox", name: "VoxPoser", color: C.vox },
    { key: "online", name: "Online agent", color: C.online },
    { key: "way", name: "COMPASS-waypoint", color: C.way },
    { key: "ours", name: "COMPASS", color: C.ours },
  ];
  const MAIN = {
    sr: { max: 15, ticks: [0, 5, 10, 15], data: {
      base: [0, 3, 1, 0], vox: [0, 0, 0, 0], online: [0, 0, 0, 0], way: [10, 1, 4, 2], ours: [12, 11, 12, 11] } },
    prog: { max: 100, ticks: [0, 50, 100], data: {
      base: [16, 41, 62, 15], vox: [28, 0, 28, 0], online: [28, 0, 4, 0], way: [75, 30, 64, 21], ours: [83, 83, 95, 77] } },
  };
  const mainEl = document.getElementById("chart-main");
  if (mainEl) {
    legend("legend-main", MAIN_SERIES.map((s) => [s.name, s.color]));
    const upd = bars(mainEl, ["Pack box", "Pack earphone", "Count fruit", "Puzzle"], MAIN_SERIES,
      { width: 860, height: 300, label: "Main results per task" });
    upd(MAIN.sr);
    document.querySelectorAll("[data-metric]").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll("[data-metric]").forEach((x) => x.classList.toggle("on", x === b));
      upd(MAIN[b.dataset.metric]);
    }));
  }

  // Interface comparison (paper Fig. 7): success and progress on pack box and count fruit.
  const IF_SERIES = [
    { key: "lang", name: "COMPASS-language", color: C.lang },
    { key: "way", name: "COMPASS-waypoint", color: C.way },
    { key: "ours", name: "COMPASS", color: C.ours },
  ];
  // Two panels as in the paper: success (of 15) and progress (%).
  const ifSr = document.getElementById("chart-iface-sr"), ifPg = document.getElementById("chart-iface-prog");
  if (ifSr && ifPg) {
    legend("legend-iface", IF_SERIES.map((s) => [s.name, s.color]));
    const TASKS2 = ["Pack box", "Count fruit"];
    bars(ifSr, TASKS2, IF_SERIES, { width: 420, height: 250, label: "Interface comparison: success of 15" })(
      { max: 15, ticks: [0, 5, 10, 15], data: { lang: [0, 0], way: [10, 4], ours: [12, 12] } });
    bars(ifPg, TASKS2, IF_SERIES, { width: 420, height: 250, label: "Interface comparison: progress" })(
      { max: 100, ticks: [0, 50, 100], fmt: (v) => v + "%", data: { lang: [15, 64], way: [75, 64], ours: [83, 95] } });
  }

  // ---------- agent table (paper Table 2) ----------
  const AGENTS = [
    ["GPT-6-Astra online (per trial)", 0, 0.0, "$17.87", "–", "online"],
    ["Qwen3.8-27B (self-hosted)", 7, 59.4, "$0", "2629 s"],
    ["GPT-6-Luna", 3, 36.7, "$0.035", "299 s"],
    ["Gemini-4-Argon", 5, 53.9, "$0.716", "424 s"],
    ["Opus 5.5", 7, 76.7, "$4.000", "574 s"],
    ["GPT-6.1-Sol", 10, 88.6, "$0.225", "270 s"],
    ["GPT-6-Astra <span class=\"muted\">(default)</span>", 11, 82.8, "$1.437", "339 s"],
  ];
  const tb = document.getElementById("agent-rows");
  if (tb) {
    tb.innerHTML = AGENTS.map(([n, sr, pg, cost, t, cls]) =>
      `<tr class="${cls || ""}"><td>${n}</td><td><span class="sr"><i style="width:${sr * 5}px"></i>${sr}/15</span></td>` +
      `<td>${cost}</td></tr>`).join("");
  }

  // ---------- policy line chart (paper Fig. 6) ----------
  const POLICY = {
    fruit: { base: { sr: [0, 13, 7, 0], prog: [0, 57, 62, 62] }, ours: { sr: [0, 47, 80, 80], prog: [0, 89, 95, 96] } },
    earphone: { base: { sr: [0, 0, 0, 20], prog: [0, 8, 14, 41] }, ours: { sr: [0, 0, 7, 73], prog: [0, 14, 32, 83] } },
  };
  const POL_NAMES = ["ACT", "π0", "π0.5", "XR1"];
  function drawPolicy(key) {
    const polEl = document.getElementById("chart-policy-" + key);
    if (!polEl) return;
    const W = 420, H = 250, m = { l: 44, r: 18, t: 22, b: 34 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Effect of the policy" });
    polEl.innerHTML = "";
    polEl.appendChild(svg);
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const X = (i) => m.l + iw * (i + 0.5) / 4, Y = (v) => m.t + ih - ih * v / 100;
    [0, 50, 100].forEach((tk) => {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(tk), y2: Y(tk), stroke: tk === 0 ? C.axis : C.grid }, svg);
      txt(svg, m.l - 8, Y(tk) + 4, tk + "%", { "text-anchor": "end", "font-size": 12, fill: C.muted });
    });
    POL_NAMES.forEach((n, i) => txt(svg, X(i), H - 10, n, { "text-anchor": "middle", "font-size": 13.5, fill: C.ink, "font-weight": 600 }));
    const d = POLICY[key];
    [["base", C.base], ["ours", C.ours]].forEach(([who, col]) => {
      [["prog", "5 4"], ["sr", null]].forEach(([met, dash]) => {
        const pts = d[who][met].map((v, i) => `${X(i)},${Y(v)}`).join(" ");
        const line = el("polyline", { points: pts, fill: "none", stroke: col, "stroke-width": 2.5, "stroke-linejoin": "round" }, svg);
        if (dash) line.setAttribute("stroke-dasharray", dash);
        d[who][met].forEach((v, i) => {
          if (met === "sr") el("circle", { cx: X(i), cy: Y(v), r: 4, fill: col }, svg);
          else el("rect", { x: X(i) - 4, y: Y(v) - 4, width: 8, height: 8, fill: col }, svg);
          if (i > 0 && v > 0) {
            const above = met === "prog";
            txt(svg, X(i) + (who === "ours" ? 11 : -11), Y(v) + (above ? -8 : 15), String(v), {
              "text-anchor": who === "ours" ? "start" : "end", "font-size": 11.5, fill: col, "font-weight": 600 });
          }
        });
      });
    });
  }
  if (document.getElementById("legend-policy")) {
    drawPolicy("fruit");
    drawPolicy("earphone");
    document.getElementById("legend-policy").innerHTML =
      `<span><i style="background:${C.base}"></i>Base policy</span>` +
      `<span><i style="background:${C.ours}"></i><em class="lgn">${nameHTML("COMPASS")}</em></span>` +
      `<span><i class="line" style="background:#6e6e73"></i>Success rate</span>` +
      `<span><i class="dash"></i>Progress</span>`;
  }

  // ---------- BibTeX copy ----------
  const cp = document.getElementById("copy-bib");
  if (cp) cp.addEventListener("click", () => {
    navigator.clipboard.writeText(document.getElementById("bib-text").textContent).then(() => {
      cp.textContent = "Copied";
      setTimeout(() => (cp.textContent = "Copy"), 1500);
    }).catch(() => {});
  });

  // ---------- side TOC highlight ----------
  const links = [...document.querySelectorAll(".toc a")];
  const secs = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  const so = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        const id = "#" + e.target.id;
        links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === id));
      }
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  secs.forEach((s) => so.observe(s));
})();
