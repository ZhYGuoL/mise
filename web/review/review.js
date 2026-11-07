/* click-review overlay: click any element, leave a comment; comments sync to review-comments.json via the server.
   Slide decks (pages built from <section class="slide">) get per-slide numbering and fit-to-width zoom.
   Any other page is one unit; each comment also records the nearest heading for context. */
(() => {
  const FILE = window.__REVIEW_FILE__ || location.pathname.replace(/^\//, "");
  const PANEL_W = 380;
  const SLIDES = document.querySelectorAll("section.slide").length > 0;
  let comments = [], mode = true, hoverEl = null, pending = null, editing = false, panelOpen = true;
  let lastContent = null, lastComments = null, hideDone = false;

  const st = document.createElement("style");
  st.textContent = `
  ${SLIDES ? `html,body{background:#d9d9d9 !important} body{padding:24px 24px 80px !important} section.slide{margin:0 auto 28px !important;position:relative}` : ""}
  body.rv-panel-open{margin-right:${PANEL_W}px !important}
  .rv-hover{outline:2px solid #2c5bff !important;outline-offset:2px;cursor:crosshair !important}
  .rv-picked{outline:2px solid #e8590c !important;outline-offset:2px}
  .rv-flash{animation:rvflash 1.2s ease 2}
  @keyframes rvflash{0%,100%{outline:3px solid transparent}50%{outline:3px solid #e8590c;outline-offset:3px}}
  .rv-pin{position:absolute;z-index:2147483000;transform:translate(-50%,-50%);min-width:26px;height:26px;padding:0 7px;border-radius:13px;background:#e8590c;color:#fff;font:600 13px/26px system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer}
  .rv-pin.done{background:#0e8f5e}
  #rv-panel,#rv-pop,#rv-toast,#rv-tab{font:14px/1.4 system-ui,-apple-system,sans-serif;color:#0a0a0a;letter-spacing:0}
  #rv-panel{position:fixed;top:0;right:0;bottom:0;width:${PANEL_W}px;background:#fff;border-left:1px solid #e4e5e8;z-index:2147483600;display:flex;flex-direction:column}
  #rv-panel header{padding:16px 18px 12px;border-bottom:1px solid #efeff1}
  #rv-panel h3{font-size:16px;font-weight:600;margin:0 0 4px}
  #rv-panel .hint{font-size:12.5px;color:#5b5f66}
  #rv-panel .row{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
  #rv-panel button,#rv-tab{font:500 13px system-ui,sans-serif;border:1px solid #d3d5da;background:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;color:#0a0a0a}
  #rv-panel button.on{background:#0a0a0a;color:#fff;border-color:#0a0a0a}
  #rv-list{flex:1;overflow:auto;padding:8px 10px 20px}
  .rv-item{border:1px solid #e4e5e8;border-radius:10px;padding:10px 12px;margin:8px 0;cursor:pointer;background:#fff}
  .rv-item:hover{border-color:#b5b9c0}
  .rv-item.done{background:#f3faf6;border-color:#cfe9db}
  .rv-item .meta{font:11.5px ui-monospace,monospace;color:#8a8f98;display:flex;justify-content:space-between;gap:8px}
  .rv-item .what{font-size:12.5px;color:#5b5f66;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rv-item .text{margin-top:6px;white-space:pre-wrap}
  .rv-item .reply{margin-top:8px;font-size:12.5px;color:#0e8f5e;white-space:pre-wrap}
  .rv-item .acts{margin-top:8px;display:flex;gap:6px}
  .rv-item .acts button{padding:3px 8px;font-size:12px}
  #rv-pop{position:fixed;z-index:2147483646;width:340px;background:#fff;border-radius:12px;box-shadow:0 0 0 1px #e4e5e8,0 18px 40px -12px rgba(0,0,0,.35);padding:12px;display:none}
  #rv-pop .what{font:11.5px ui-monospace,monospace;color:#8a8f98;margin-bottom:8px;max-height:48px;overflow:hidden}
  #rv-pop textarea{width:100%;box-sizing:border-box;height:90px;border:1px solid #d3d5da;border-radius:8px;padding:8px;font:14px system-ui,sans-serif;resize:vertical;color:#0a0a0a;background:#fff}
  #rv-pop .row{display:flex;gap:6px;margin-top:8px;align-items:center}
  #rv-pop button{font:500 13px system-ui,sans-serif;border:1px solid #d3d5da;background:#fff;border-radius:8px;padding:5px 10px;cursor:pointer;color:#0a0a0a}
  #rv-pop button.primary{background:#0a0a0a;color:#fff;border-color:#0a0a0a;margin-left:auto}
  #rv-toast{position:fixed;left:24px;bottom:20px;z-index:2147483647;background:#0a0a0a;color:#fff;border-radius:10px;padding:8px 14px;font-size:13px;opacity:0;transition:opacity .2s}
  #rv-tab{position:fixed;right:12px;top:12px;z-index:2147483600;display:none;box-shadow:0 4px 14px rgba(0,0,0,.15)}
  `;
  document.head.appendChild(st);
  document.body.classList.add("rv-panel-open");

  // ---------- units (slides, or the whole page)
  const units = () => (SLIDES ? [...document.querySelectorAll("section.slide")] : [document.body]);
  const unitOf = (el) => (SLIDES ? el && el.closest && el.closest("section.slide") : document.body);
  const unitNo = (u) => units().indexOf(u) + 1;
  if (!SLIDES && getComputedStyle(document.body).position === "static") document.body.style.position = "relative";
  function fit() {
    if (!SLIDES) return;
    const w = units()[0].offsetWidth || 1600;
    const avail = window.innerWidth - (panelOpen ? PANEL_W : 0) - 48;
    const z = Math.min(1, avail / w);
    units().forEach((s) => (s.style.zoom = z));
  }
  window.addEventListener("resize", () => { fit(); renderPins(); });
  fit();

  function unitLabel(u, el) {
    if (SLIDES) {
      const n = u.querySelector(".top .n, .n"), h = u.querySelector("h1, h2");
      return [n && n.textContent.trim(), h && h.textContent.trim()].filter(Boolean).join(" · ") || `Slide ${unitNo(u)}`;
    }
    // nearest heading at or before the element
    const hs = [...document.querySelectorAll("h1,h2,h3")].filter((h) => !h.closest("#rv-panel"));
    let best = null;
    for (const h of hs) { if (h === el || (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) || h.contains(el)) best = h; }
    return best ? best.textContent.trim().replace(/\s+/g, " ").slice(0, 100) : document.title;
  }
  function cssPath(el, u) {
    const parts = [];
    let cur = el;
    while (cur && cur !== u) {
      const p = cur.parentElement;
      const same = [...p.children].filter((c) => c.tagName === cur.tagName);
      parts.unshift(cur.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(cur) + 1})` : ""));
      cur = p;
    }
    return parts.join(" > ");
  }
  function snippet(el) {
    if (el.tagName === "IMG") return "[image] " + (el.getAttribute("src") || "");
    const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (t) return t.slice(0, 160);
    const img = el.querySelector && el.querySelector("img");
    if (img) return "[image] " + img.getAttribute("src");
    if (el.tagName.toLowerCase() === "svg" || (el.querySelector && el.querySelector("svg"))) return "[icon/graphic]";
    return "[" + el.tagName.toLowerCase() + "]";
  }
  function boxIn(el, u) {
    const r = el.getBoundingClientRect(), ur = u.getBoundingClientRect();
    if (SLIDES) return { x: +((r.left - ur.left) / ur.width * 100).toFixed(1), y: +((r.top - ur.top) / ur.height * 100).toFixed(1), w: +(r.width / ur.width * 100).toFixed(1), h: +(r.height / ur.height * 100).toFixed(1) };
    return { x: Math.round(r.left - ur.left), y: Math.round(r.top - ur.top), w: Math.round(r.width), h: Math.round(r.height), px: true };
  }
  function find(c) {
    const u = units()[(c.section || c.slide || 1) - 1];
    if (!u) return null;
    try { return c.path ? u.querySelector(":scope > " + c.path) || u : u; } catch (e) { return u; }
  }
  const pickable = (el) => {
    if (!el || !el.closest || el.closest("#rv-panel,#rv-pop,#rv-tab,#rv-toast,.rv-pin")) return null;
    if (!unitOf(el) || el === document.documentElement) return null;
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") el = el.closest("svg");
    return el;
  };

  // ---------- UI
  const panel = document.createElement("div");
  panel.id = "rv-panel";
  panel.innerHTML = `<header><h3>Comments</h3>
    <div class="hint">Click anything and type what you want changed. <b>Enter</b> saves, <b>Shift+Enter</b> new line, <b>↑ Wider</b> picks the surrounding block, <b>C</b> toggles comment mode.</div>
    <div class="row"><button id="rv-mode" class="on">Comment mode: on</button><button id="rv-hide">Hide done</button><button id="rv-close">Hide panel</button><span id="rv-count" class="hint"></span></div></header>
    <div id="rv-list"></div>`;
  document.body.appendChild(panel);
  const tab = document.createElement("button");
  tab.id = "rv-tab"; tab.textContent = "Comments";
  document.body.appendChild(tab);
  const listEl = panel.querySelector("#rv-list");
  const modeBtn = panel.querySelector("#rv-mode");
  panel.querySelector("#rv-hide").onclick = (e) => { hideDone = !hideDone; e.target.classList.toggle("on", hideDone); renderList(); renderPins(); };
  modeBtn.onclick = () => setMode(!mode);
  const setPanel = (open) => { panelOpen = open; panel.style.display = open ? "flex" : "none"; tab.style.display = open ? "none" : "block"; document.body.classList.toggle("rv-panel-open", open); fit(); renderPins(); };
  panel.querySelector("#rv-close").onclick = () => setPanel(false);
  tab.onclick = () => setPanel(true);

  const pop = document.createElement("div");
  pop.id = "rv-pop";
  pop.innerHTML = `<div class="what"></div><textarea placeholder="What should change here?"></textarea>
    <div class="row"><button data-a="wider">↑ Wider</button><button data-a="cancel">Cancel</button><button class="primary" data-a="save">Save</button></div>`;
  document.body.appendChild(pop);
  const popWhat = pop.querySelector(".what"), popText = pop.querySelector("textarea");
  const toast = document.createElement("div");
  toast.id = "rv-toast";
  document.body.appendChild(toast);
  const say = (m) => { toast.textContent = m; toast.style.opacity = 1; clearTimeout(say.t); say.t = setTimeout(() => (toast.style.opacity = 0), 1800); };
  function setMode(on) {
    mode = on; modeBtn.textContent = "Comment mode: " + (on ? "on" : "off"); modeBtn.classList.toggle("on", on);
    if (!on && hoverEl) { hoverEl.classList.remove("rv-hover"); hoverEl = null; }
  }

  document.addEventListener("mouseover", (e) => {
    if (!mode || editing) return;
    const el = pickable(e.target);
    if (hoverEl && hoverEl !== el) hoverEl.classList.remove("rv-hover");
    hoverEl = el; if (el) el.classList.add("rv-hover");
  }, true);
  document.addEventListener("click", (e) => {
    if (!mode) return;
    const el = pickable(e.target);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    openPop(el, e.clientX, e.clientY);
  }, true);
  const describe = (el) => `${SLIDES ? "Slide " + unitNo(unitOf(el)) : unitLabel(unitOf(el), el)} · ${snippet(el)}`;
  function openPop(el, x, y) {
    if (pending) pending.el.classList.remove("rv-picked");
    pending = { el }; el.classList.remove("rv-hover"); el.classList.add("rv-picked"); editing = true;
    popWhat.textContent = describe(el); popText.value = ""; pop.style.display = "block";
    pop.style.left = Math.max(12, Math.min(x + 12, window.innerWidth - (panelOpen ? PANEL_W : 0) - 360)) + "px";
    pop.style.top = Math.max(12, Math.min(y + 12, window.innerHeight - 200)) + "px";
    setTimeout(() => popText.focus(), 0);
  }
  function closePop() { pop.style.display = "none"; if (pending) pending.el.classList.remove("rv-picked"); pending = null; editing = false; }
  pop.addEventListener("click", (e) => {
    const a = e.target.getAttribute && e.target.getAttribute("data-a");
    if (a === "cancel") closePop();
    if (a === "save") saveNew();
    if (a === "wider" && pending) {
      const u = unitOf(pending.el), p = pending.el.parentElement;
      if (pending.el !== u && p && (SLIDES ? u.contains(p) : p !== document.documentElement)) {
        pending.el.classList.remove("rv-picked"); pending.el = p; p.classList.add("rv-picked"); popWhat.textContent = describe(p);
      }
      popText.focus();
    }
  });
  popText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNew(); }
    if (e.key === "Escape") closePop();
  });
  document.addEventListener("keydown", (e) => {
    if (editing || /input|textarea|select/i.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
    if (e.key === "c" || e.key === "C") setMode(!mode);
  });

  async function saveNew() {
    const text = popText.value.trim();
    if (!pending || !text) { closePop(); return; }
    const el = pending.el, u = unitOf(el);
    const id = comments.reduce((m, c) => Math.max(m, c.id || 0), 0) + 1;
    const n = unitNo(u);
    comments.push({ id, file: FILE, section: n, slide: SLIDES ? n : undefined, sectionLabel: unitLabel(u, el), path: el === u ? "" : cssPath(el, u), target: snippet(el), box: boxIn(el, u), comment: text, status: "open", reply: "", created: new Date().toISOString() });
    closePop(); await persist(); say(`Comment #${id} saved`);
  }
  async function persist() {
    localStorage.setItem("click-review-backup:" + FILE, JSON.stringify(comments));
    try {
      await fetch("/__review/api/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(comments) });
      lastComments = (await (await fetch("/__review/api/version")).json()).comments;
    } catch (e) { say("Couldn't reach the review server; kept a local copy"); }
    renderList(); renderPins();
  }
  const mine = () => comments.filter((c) => (c.file || c.deck) === FILE);

  function renderPins() {
    document.querySelectorAll(".rv-pin").forEach((p) => p.remove());
    mine().filter((c) => !(hideDone && c.status === "done")).forEach((c) => {
      const u = units()[(c.section || c.slide || 1) - 1];
      if (!u) return;
      const el = find(c);
      const b = el && el !== u ? boxIn(el, u) : (c.box || { x: 0, y: 0 });
      const pin = document.createElement("div");
      pin.className = "rv-pin" + (c.status === "done" ? " done" : "");
      pin.textContent = c.id; pin.title = c.comment;
      if (SLIDES) { pin.style.left = `calc(${b.x}% + 2px)`; pin.style.top = `calc(${b.y}% + 2px)`; }
      else { pin.style.left = (b.x + 2) + "px"; pin.style.top = (b.y + 2) + "px"; }
      pin.onclick = (e) => { e.stopPropagation(); setPanel(true); const d = document.getElementById("rv-item-" + c.id); if (d) { d.scrollIntoView({ behavior: "smooth", block: "center" }); d.style.borderColor = "#e8590c"; setTimeout(() => (d.style.borderColor = ""), 1500); } };
      u.appendChild(pin);
    });
  }
  function renderList() {
    const all = mine(), open = all.filter((c) => c.status !== "done").length;
    panel.querySelector("#rv-count").textContent = `${open} open · ${all.length - open} done`;
    const items = all.filter((c) => !(hideDone && c.status === "done")).sort((a, b) => (a.section || a.slide || 0) - (b.section || b.slide || 0) || a.id - b.id);
    listEl.innerHTML = items.length ? "" : `<div class="hint" style="padding:12px 8px">No comments yet. Click anything on the page.</div>`;
    for (const c of items) {
      const d = document.createElement("div");
      d.className = "rv-item" + (c.status === "done" ? " done" : ""); d.id = "rv-item-" + c.id;
      d.innerHTML = `<div class="meta"><span></span><span>${c.status === "done" ? "done" : "open"}</span></div><div class="what"></div><div class="text"></div>${c.reply ? '<div class="reply"></div>' : ""}
        <div class="acts"><button data-a="go">Show</button><button data-a="toggle">${c.status === "done" ? "Reopen" : "Mark done"}</button><button data-a="del">Delete</button></div>`;
      d.querySelector(".meta span").textContent = `#${c.id} · ${SLIDES ? "slide " + (c.section || c.slide) : (c.sectionLabel || "page")}`;
      d.querySelector(".what").textContent = c.target;
      d.querySelector(".text").textContent = c.comment;
      if (c.reply) d.querySelector(".reply").textContent = "↳ " + c.reply;
      d.onclick = async (e) => {
        const a = e.target.getAttribute && e.target.getAttribute("data-a");
        if (a === "del") { comments = comments.filter((x) => x !== c); return persist(); }
        if (a === "toggle") { c.status = c.status === "done" ? "open" : "done"; return persist(); }
        const el = find(c); if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("rv-flash"); void el.offsetWidth; el.classList.add("rv-flash");
      };
      listEl.appendChild(d);
    }
  }
  async function load() {
    try { comments = await (await fetch("/__review/api/comments")).json(); }
    catch (e) { comments = JSON.parse(localStorage.getItem("click-review-backup:" + FILE) || "[]"); }
    renderList(); renderPins();
  }
  async function poll() {
    try {
      const v = await (await fetch("/__review/api/version")).json();
      if (lastContent === null) { lastContent = v.content; lastComments = v.comments; }
      else if (v.content !== lastContent && !editing) { sessionStorage.setItem("rv-scroll", String(window.scrollY)); location.reload(); return; }
      else if (v.comments !== lastComments && !editing) { lastComments = v.comments; await load(); say("Comments updated"); }
    } catch (e) {}
    setTimeout(poll, 1500);
  }
  const sy = sessionStorage.getItem("rv-scroll");
  if (sy) { sessionStorage.removeItem("rv-scroll"); setTimeout(() => window.scrollTo(0, +sy), 60); say("Page updated"); }
  if (document.fonts) document.fonts.ready.then(() => { fit(); renderPins(); });
  load().then(poll);
})();
