// Devnuby chat UI — interaction layer
// Self-contained, no external deps. Streaming/copy/typing/demo replies only.

(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const els = {
    app: $("#app"),
    sidebar: $("#sidebar"),
    scrim: $("#scrim"),
    welcome: $("#welcome"),
    thread: $("#thread"),
    threadInner: $("#threadInner"),
    composer: $("#composer"),
    input: $("#input"),
    sendBtn: $("#sendBtn"),
    history: $("#history"),
    historySearch: $("#historySearch"),
    historyEmpty: $("#historyEmpty"),
    model: $("#model"),
    modelBtn: $("#modelBtn"),
    modelMenu: $("#modelMenu"),
    modelName: $("#modelName"),
    modelMeta: $("#modelMeta"),
    chatTitleLabel: $("#chatTitleLabel"),
    suggest: $("#suggest"),
    toast: $("#toast"),
  };

  // ─── shared helpers ──────────────────────────────────────────────
  function toast(msg, ms = 2200) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (els.toast.hidden = true), ms);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function scrollThreadBottom() {
    els.thread.scrollTop = els.thread.scrollHeight;
  }

  // ─── sidebar: mobile drawer + desktop collapse ───────────────────
  function openSidebar() {
    els.sidebar.classList.add("is-open");
    els.scrim.hidden = false;
  }

  function closeSidebar() {
    els.sidebar.classList.remove("is-open");
    els.scrim.hidden = true;
  }

  function collapseSidebar() {
    els.app.classList.add("is-collapsed");
  }

  function expandSidebar() {
    els.app.classList.remove("is-collapsed");
  }

  function isMobile() { return window.innerWidth <= 900; }

  // ─── custom dropdown manager (model selector + popovers) ─────────
  // dropdowns are detached to <body> with position:fixed so they never
  // get clipped by parent overflow. We compute coords from the trigger.
  let activeMenu = null; // { menu, trigger, wrap, type }

  function positionDropdown(menu, trigger) {
    const r = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;
    const pad = 8;

    // reset so measurement is not constrained by a previous max-height
    menu.style.maxHeight = "";
    const mw = Math.max(menu.offsetWidth, 220);
    const naturalH = menu.offsetHeight;

    let left = r.left;

    // horizontal: align left edge, flip to right-align if it would overflow
    if (left + mw > vw - pad) {
      left = Math.max(pad, r.right - mw);
      menu.classList.add("dropdown--end");
    } else {
      menu.classList.remove("dropdown--end");
    }
    left = Math.min(Math.max(pad, left), vw - mw - pad);

    const spaceBelow = vh - r.bottom - gap - pad;
    const spaceAbove = r.top - gap - pad;

    // Prefer below. If it doesn't fit, open upward.
    const openUp = naturalH > spaceBelow && (spaceAbove > spaceBelow || naturalH <= spaceAbove);

    // Anchor the edge nearest the trigger: top when opening down,
    // bottom when opening up. This way height changes grow away from
    // the trigger instead of shifting the panel around.
    menu.style.left = left + "px";
    if (openUp) {
      menu.classList.add("dropdown--up");
      menu.style.top = "auto";
      menu.style.bottom = (vh - r.top + gap) + "px";
      menu.style.maxHeight = Math.max(120, spaceAbove) + "px";
    } else {
      menu.classList.remove("dropdown--up");
      menu.style.bottom = "auto";
      menu.style.top = (r.bottom + gap) + "px";
      menu.style.maxHeight = Math.max(120, spaceBelow) + "px";
    }
  }

  function closeActiveMenu() {
    if (!activeMenu) return;
    // hide + restore every panel that may have been detached
    const panels = [activeMenu.menu, els.modelMenu].filter(Boolean);
    panels.forEach((m) => {
      m.classList.remove("is-visible");
      m.hidden = true;
      m.style.left = "";
      m.style.top = "";
      m.style.bottom = "";
      m.style.maxHeight = "";
      m.classList.remove("dropdown--up", "dropdown--end");
      const home = m._homeParent;
      if (home && m.parentElement === document.body) home.appendChild(m);
    });
    // always return the model dropdown to its quick view for next open
    resetModelView();
    activeMenu.trigger.setAttribute("aria-expanded", "false");
    if (activeMenu.wrap) activeMenu.wrap.classList.remove("is-open");
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
    activeMenu = null;
  }

  function reposition() {
    if (!activeMenu) return;
    positionDropdown(activeMenu.menu, activeMenu.trigger);
  }

  function openMenu({ menu, trigger, wrap = null, type = "menu" }) {
    closeActiveMenu();
    // detach to body so it escapes any overflow:hidden / stacking contexts
    const homeParent = menu.parentElement;
    menu.hidden = false;
    if (homeParent && homeParent !== document.body) document.body.appendChild(menu);
    // for model dropdown, ensure quick view is active and height is set
    if (menu.id === "modelMenu") {
      resetModelView();
      const active = activeModelView();
      const container = $("#modelViews");
      if (active && container) {
        container.style.height = active.scrollHeight + "px";
      }
    }
    positionDropdown(menu, trigger);
    // reveal on next frame, with a fallback timeout (rAF can be throttled)
    const reveal = () => menu.classList.add("is-visible");
    requestAnimationFrame(reveal);
    setTimeout(() => { if (!menu.classList.contains("is-visible")) reveal(); }, 60);
    trigger.setAttribute("aria-expanded", "true");
    if (wrap) wrap.classList.add("is-open");
    activeMenu = { menu, trigger, wrap, type, homeParent };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
  }

  function toggleMenu(ctx) {
    const isOpen = ctx.menu.classList.contains("is-visible");
    if (isOpen) closeActiveMenu(); else openMenu(ctx);
  }

  function menuItems(menu) {
    return [...menu.querySelectorAll('[role="option"], [role="menuitem"]')];
  }

  function setActiveItem(items, idx) {
    items.forEach((el) => el.classList.remove("is-active"));
    if (items[idx]) items[idx].classList.add("is-active");
  }

  function getActiveIndex(items) {
    return items.findIndex((el) => el.classList.contains("is-active"));
  }

  function activateItem(item) {
    item.click();
  }

  function updateModelSelection() {
    const name = els.modelName.textContent;

    // catalog items inside the single dropdown shell
    $$(".catalog__item").forEach((item) => {
      item.setAttribute("aria-selected", String(item.dataset.model === name));
    });

    // card summary in quick view
    const fullName = $("#modelCardName");
    const fullDesc = $("#modelCardDesc");
    const active = $(`.catalog__item[data-model="${CSS.escape(name)}"]`) || $(`.catalog__item[data-model="${name}"]`);
    if (active && fullName) {
      fullName.textContent = active.dataset.full || active.dataset.model;
      fullDesc.textContent = active.dataset.desc || active.dataset.meta;
    }
  }

  function selectModel(btn) {
    els.modelName.textContent = btn.dataset.model;
    if (els.modelMeta) els.modelMeta.textContent = btn.dataset.meta;
    updateModelSelection();
    closeActiveMenu();
    toast("Model: " + (btn.dataset.full || btn.dataset.model));
  }

  // ─── model dropdown: animated in-place view switch ──────────────
  // Both views live inside a single shell (#modelMenu). Switching from
  // quick → catalog slides left, catalog → quick slides right.
  function modelViews() {
    return [...document.querySelectorAll(".model-view")];
  }

  function activeModelView() {
    return document.querySelector(".model-view.is-active");
  }

  function setModelViewHeight(view) {
    const container = $("#modelViews");
    if (!container || !view) return;
    // measure the target's natural height (views are absolutely positioned)
    const h = view.scrollHeight;
    container.style.height = h + "px";
  }

  function switchModelView(targetViewName) {
    const container = $("#modelViews");
    if (!container) return;
    const current = activeModelView();
    const target = container.querySelector(`.model-view[data-view="${targetViewName}"]`);
    if (!target || current === target) return;

    // direction: quick→catalog = forward (target enters from right, current exits left)
    // catalog→quick = backward (target enters from left, current exits right)
    const forward = current.dataset.view === "quick" && targetViewName === "catalog";

    target.classList.remove("is-leaving-left", "is-leaving-right", "is-entering-left", "is-entering-right");
    target.style.transition = "none";
    target.classList.add(forward ? "is-entering-right" : "is-entering-left");
    // Commit the starting pose before enabling the incoming transition.
    void target.offsetHeight;
    target.style.transition = "";

    current.classList.remove("is-active", "is-leaving-left", "is-leaving-right");
    current.classList.add(forward ? "is-leaving-left" : "is-leaving-right");
    target.classList.remove("is-entering-left", "is-entering-right");
    target.classList.add("is-active");
    container.style.height = target.scrollHeight + "px";
  }

  function openModelCatalog() { switchModelView("catalog"); }
  function backToModelQuick() { switchModelView("quick"); }

  // snap back to the quick view without animation (used on close / init)
  function resetModelView() {
    const container = $("#modelViews");
    if (!container) return;
    const views = [...container.querySelectorAll(".model-view")];
    views.forEach((v) => {
      v.classList.remove("is-active", "is-leaving-left", "is-leaving-right", "is-entering-left", "is-entering-right");
    });
    const quick = container.querySelector('.model-view[data-view="quick"]');
    if (quick) {
      quick.classList.add("is-active");
      container.style.height = "";
    }
  }

  function setReasoningLabel(value) {
    const labels = ["Mati", "Rendah", "Sedang", "Tinggi", "Maks"];
    const el = $("#reasoningValue");
    if (el) el.textContent = labels[value] || "Sedang";
  }

  // ─── chat title (top bar) ───────────────────────────────────────
  function setChatTitle(text) {
    const label = els.chatTitleLabel;
    label.textContent = text || "Percakapan baru";
  }

  // ─── history filter ──────────────────────────────────────────────
  function filterHistory() {
    const q = els.historySearch.value.trim().toLowerCase();
    let visible = 0;
    $$(".history__item", els.history).forEach((item) => {
      const match = !q || item.dataset.text.toLowerCase().includes(q);
      item.style.display = match ? "" : "none";
      if (match) visible++;
    });
    $$(".history__group", els.history).forEach((g) => {
      const nextList = g.nextElementSibling;
      if (!nextList) return;
      const hasVisible = [...nextList.querySelectorAll(".history__item")]
        .some((i) => i.style.display !== "none");
      g.style.display = hasVisible ? "" : "none";
    });
    els.historyEmpty.hidden = visible > 0;
  }

  // ─── message rendering ───────────────────────────────────────────
  // User → bubble (right-aligned). AI → flat .message__content (no bubble).

  function messageWrap(role) {
    const wrap = document.createElement("div");
    wrap.className = "message message--" + role;
    return wrap;
  }

  function renderUser(text) {
    const wrap = messageWrap("user");
    const bubble = document.createElement("div");
    bubble.className = "message__bubble";
    bubble.innerHTML = "<p>" + escapeHtml(text).replace(/\n/g, "<br>") + "</p>";
    wrap.append(bubble);
    return wrap;
  }

  // ── markdown → HTML (reference parser; will be replaced by an npm
  //    library like react-markdown / marked when this becomes a React project) ──
  const MD = (() => {
    // 1. protect fenced code blocks first
    function extractCode(src) {
      const blocks = [];
      const out = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const i = blocks.length;
        blocks.push({ lang: lang || "", code: code.replace(/\n$/, "") });
        return `\u0000CODE${i}\u0000`;
      });
      return { out, blocks };
    }

    // 2. tables (GFM): header row + separator + body rows
    function table(src) {
      const lines = src.split(/\n/);
      if (lines.length < 2) return src;
      const sep = lines[1];
      if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(sep) || sep.split("|").length < 2) return src;
      const splitRow = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const header = splitRow(lines[0]);
      const body = lines.slice(2).filter((l) => l.trim()).map(splitRow);
      const thead = "<thead><tr>" + header.map((h) => "<th>" + inline(h) + "</th>").join("") + "</tr></thead>";
      const tbody = "<tbody>" + body.map((row) =>
        "<tr>" + row.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>"
      ).join("") + "</tbody>";
      return "<table>" + thead + tbody + "</table>";
    }

    // 3. inline: code, bold, italic, links
    function inline(src) {
      let s = escapeHtml(src);
      s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return s;
    }

    // 4. block-level: headings, lists, blockquote, hr, paragraphs
    function block(src) {
      const lines = src.replace(/\r/g, "").split(/\n/);
      const out = [];
      let i = 0, para = [];

      function flushPara() {
        if (para.length) {
          out.push("<p>" + inline(para.join(" ")) + "</p>");
          para = [];
        }
      }

      while (i < lines.length) {
        const line = lines[i];

        // table block: detect header + separator
        if (line.includes("|") && lines[i + 1] && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
          flushPara();
          let tbl = [line, lines[i + 1]];
          let j = i + 2;
          while (j < lines.length && lines[j].includes("|")) { tbl.push(lines[j]); j++; }
          out.push(table(tbl.join("\n")));
          i = j;
          continue;
        }

        // fenced code placeholder
        if (/^\u0000CODE\d+\u0000$/.test(line.trim())) {
          flushPara();
          out.push(line.trim());
          i++;
          continue;
        }

        // heading
        const h = /^(#{1,4})\s+(.*)$/.exec(line);
        if (h) { flushPara(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

        // hr
        if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushPara(); out.push("<hr>"); i++; continue; }

        // blockquote
        if (/^>\s?/.test(line)) {
          flushPara();
          const buf = [];
          while (i < lines.length && /^>\s?/.test(lines[i])) {
            buf.push(lines[i].replace(/^>\s?/, ""));
            i++;
          }
          out.push("<blockquote>" + block(buf.join("\n")) + "</blockquote>");
          continue;
        }

        // unordered list
        if (/^\s*[-*]\s+/.test(line)) {
          flushPara();
          const buf = [];
          while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
            buf.push("<li>" + inline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>");
            i++;
          }
          out.push("<ul>" + buf.join("") + "</ul>");
          continue;
        }

        // ordered list
        if (/^\s*\d+\.\s+/.test(line)) {
          flushPara();
          const buf = [];
          while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
            buf.push("<li>" + inline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>");
            i++;
          }
          out.push("<ol>" + buf.join("") + "</ol>");
          continue;
        }

        // blank line → paragraph break
        if (line.trim() === "") { flushPara(); i++; continue; }

        para.push(line.trim());
        i++;
      }
      flushPara();
      return out.join("\n");
    }

    function render(src) {
      const { out, blocks } = extractCode(src);
      let html = block(out);
      // restore code blocks with header bar
      html = html.replace(/\u0000CODE(\d+)\u0000/g, (_, n) => {
        const b = blocks[+n];
        const lang = b.lang || "code";
        const langTag = b.lang ? `<span class="code__lang">${escapeHtml(b.lang)}</span>` : `<span class="code__lang">code</span>`;
        const head = `<div class="code__head">${langTag}<button type="button" class="code__copy" data-act="copy-code" aria-label="Salin kode"><svg class="icon"><use href="#i-copy"/></svg><span>Salin</span></button></div>`;
        return `<pre data-lang="${escapeHtml(lang)}">${head}<code>${escapeHtml(b.code)}</code></pre>`;
      });
      return html;
    }

    return { render, inline };
  })();

  function renderAI(text) {
    const wrap = messageWrap("ai");
    const content = document.createElement("div");
    content.className = "message__content";
    content.innerHTML = MD.render(text);
    wrap.append(content);
    return wrap;
  }

  function actionsRow() {
    const row = document.createElement("div");
    row.className = "message__actions";
    row.innerHTML = `
      <button type="button" data-act="copy" aria-label="Salin jawaban">
        <svg class="icon icon--sm"><use href="#i-copy"/></svg><span>Salin</span>
      </button>
      <button type="button" data-act="regenerate" aria-label="Buat ulang jawaban">
        <svg class="icon icon--sm"><use href="#i-refresh"/></svg><span>Buat ulang</span>
      </button>`;
    return row;
  }

  function appendMessage(role, text) {
    const el = role === "user" ? renderUser(text) : renderAI(text);
    if (role === "ai") el.append(actionsRow());
    els.threadInner.append(el);
    scrollThreadBottom();
    return el;
  }

  function typingIndicator() {
    const el = document.createElement("div");
    el.className = "typing";
    el.innerHTML = `<span class="typing__dot"></span><span class="typing__dot"></span><span class="typing__dot"></span>`;
    els.threadInner.append(el);
    scrollThreadBottom();
    return el;
  }

  // ─── demo streaming reply ────────────────────────────────────────
  const DEMO_REPLIES = {
    billing: `Tentu. Untuk API billing dengan **pagination** dan **bearer auth**, pola umumnya seperti ini:

## Contoh permintaan

\`\`\`http
GET /api/v1/invoices?page=2&per_page=20
Authorization: Bearer <token>
Accept: application/json
\`\`\`

## Catatan implementasi

1. Verifikasi token via middleware, jangan di controller.
2. Query dengan \`offset/limit\`, jangan \`SELECT *\`.
3. Kembalikan header \`Link\` rel="next" untuk navigasi kursor.

| Field | Tipe | Wajib | Catatan |
| --- | --- | --- | --- |
| page | int | ya | Mulai dari 1 |
| per_page | int | tidak | Default 20, maks 100 |
| status | string | tidak | \`paid\`, \`unpaid\`, \`void\` |

> Rate limit: 600 permintaan / menit per token. Lampirkan \`X-Request-Id\` untuk pelacakan.

Balasan standar: \`{ data: [...], meta: { page, per_page, total } }\``,
    cli: `## Dokumentasi CLI yang ringkas

Struktur yang saya sarankan:

1. **Satu kalimat** tentang fungsinya di paling atas.
2. Bagian \`Usage\` dengan contoh yang bisa langsung salin-tempel.
3. Tabel flag hanya yang sering dipakai — sisanya di \`--help\`.
4. Akhiri dengan satu contoh alur kerja nyata.

\`\`\`bash
devnuby deploy --env production --quiet
\`\`\`

> Hindari paragraf panjang. Pengguna CLI ingin *scan*, bukan baca.`,
    race: `## Penyebab race condition di worker queue

Biasanya dari **dua sumber**:

- Pekerja mengambil *job* yang sama sebelum status di-flip
- *Shared state* di-mutasi tanpa lock

## Perbaikan

1. **Atomic claim** — jangan SELECT lalu UPDATE, lakukan dalam satu pernyataan:

\`\`\`sql
UPDATE jobs
SET worker = $1, status = 'running', claimed_at = now()
WHERE id = $2 AND status = 'pending'
RETURNING *;
\`\`\`

Cek \`affected_rows\`. Kalau 0, job sudah diambil pekerja lain.

2. **Pisahkan queue** per resource bila konflik tinggi.
3. **Idempotency key** agar retry tidak dobel-eksekusi.

| Gejala | Kemungkinan | Cek |
| --- | --- | --- |
| Job dobel | Claim tidak atomic | \`affected_rows\` |
| Data inkonsisten | Shared state tanpa lock | Log urutan mutate |
| Retry menumpuk | Tidak ada idempotency | Tabel \`idempotency_keys\` |`,
    migrate: `## Rencana migrasi database tanpa downtime

Intinya: **jalankan dua sistem paralel**, lalu potong bertahap.

### Fase

1. **Dual-write** ke DB lama + DB baru.
2. **Backfill** data historis ke DB baru.
3. **Baca dari DB baru** untuk verifikasi (shadow read).
4. **Alihkan baca penuh**, hentikan dual-write.
5. **Pensiunkan DB lama** setelah grace period 7 hari.

> Setiap fase punya *rollback plan*. Jangan lanjut sebelum fase sebelumnya stabil minimal 24 jam.

\`\`\`text
DB lama ──┬── dual-write ──→ DB baru
          │                     │
          └── shadow read ←─────┘
\`\`\`

Kalau volumenya besar, pertimbangkan **CDC** (change data capture) untuk backfill awal.`,
    default: `## Kerangka jawaban

Pertanyaan bagus. Berikut pendekatan umumnya:

1. **Definisikan tujuan dan batasan** dulu.
2. **Pisahkan** menjadi langkah kecil yang bisa diuji.
3. **Validasi** tiap langkah sebelum lanjut.

\`\`\`text
tujuan → batasan → langkah → validasi → selesai
\`\`\`

Kalau mau, sebutkan konteks tambahan supaya saya bisa turun ke detail konkret — bahasa, stack, atau batasan tertentu.`,
  };

  function pickReply(prompt) {
    const p = prompt.toLowerCase();
    if (p.includes("billing") || p.includes("rest") || p.includes("endpoint")) return DEMO_REPLIES.billing;
    if (p.includes("cli") || p.includes("dokumentasi")) return DEMO_REPLIES.cli;
    if (p.includes("race") || p.includes("worker") || p.includes("queue")) return DEMO_REPLIES.race;
    if (p.includes("migrasi") || p.includes("database")) return DEMO_REPLIES.migrate;
    return DEMO_REPLIES.default;
  }

  async function streamReply(prompt, onDone) {
    const typing = typingIndicator();
    await wait(600);
    typing.remove();

    const reply = pickReply(prompt);
    const el = renderAI("");
    el.append(actionsRow());
    els.threadInner.append(el);
    const content = el.querySelector(".message__content");

    let i = 0;
    const chunk = Math.max(3, Math.round(reply.length / 110));
    return new Promise((resolve) => {
      function step() {
        i += chunk;
        content.innerHTML = MD.render(reply.slice(0, i));
        scrollThreadBottom();
        if (i < reply.length) {
          requestAnimationFrame(step);
        } else {
          content.innerHTML = MD.render(reply);
          scrollThreadBottom();
          onDone && onDone(el);
          resolve(el);
        }
      }
      step();
    });
  }

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ─── send flow ───────────────────────────────────────────────────
  async function send(text) {
    if (!text.trim()) return;
    if (els.welcome && !els.welcome.hidden) els.welcome.hidden = true;

    // first message becomes the chat title
    if (!els.chatTitleLabel.dataset.locked) {
      setChatTitle(text.trim().slice(0, 60));
      els.chatTitleLabel.dataset.locked = "1";
    }

    appendMessage("user", text);
    els.input.value = "";
    autosize();
    updateSendState();
    els.sendBtn.disabled = true;

    await streamReply(text, (el) => {
      els.sendBtn.disabled = false;
      updateSendState();
    });
  }

  // ─── textarea autosize + send button state ───────────────────────
  function autosize() {
    const t = els.input;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 240) + "px";
  }

  function updateSendState() {
    els.sendBtn.disabled = els.input.value.trim().length === 0;
  }

  // ─── action delegation ───────────────────────────────────────────

  function handleAction(btn) {
    const a = btn.dataset.action;
    switch (a) {
      case "new-chat": resetThread(); setChatTitle(""); toast("Percakapan baru dimulai"); break;
      case "toggle-sidebar": closeSidebar(); break;
      case "open-sidebar":
        if (isMobile()) openSidebar(); else expandSidebar();
        break;
      case "close-sidebar": closeSidebar(); break;
      case "collapse-sidebar":
        if (isMobile()) closeSidebar(); else collapseSidebar();
        break;
      case "expand-sidebar": expandSidebar(); break;
      case "toggle-model":
        toggleMenu({
          menu: els.modelMenu,
          trigger: btn,
          wrap: els.model,
          type: "listbox",
        });
        break;
      case "open-catalog": openModelCatalog(); break;
      case "back-to-quick": backToModelQuick(); break;
      case "toggle-popover": {
        const targetId = btn.dataset.popover;
        const menu = targetId ? document.getElementById(targetId) : null;
        if (!menu) return;
        toggleMenu({ menu, trigger: btn, wrap: btn.parentElement, type: "menu" });
        break;
      }
      case "toggle-theme": toggleTheme(btn); break;
      case "share": toast("Tautan percakapan disalin"); break;
      case "attach": toast("Lampiran belum tersedia di demo"); break;
      case "mic": toast("Input suara belum tersedia di demo"); break;
    }
  }

  function handleListAction(btn) {
    if (btn.dataset.model) selectModel(btn);
  }

  function handleMenuItem(btn) {
    // popover menu items
    const action = btn.dataset.action;
    const tool = btn.dataset.tool;

    // attach popover: tool toggles (Web / Kode)
    if (tool) {
      const pressed = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-pressed", String(!pressed));
      btn.classList.toggle("is-active", !pressed);
      toast(`${tool} ${!pressed ? "aktif" : "nonaktif"}`);
      closeActiveMenu();
      return;
    }

    const map = {
      attach: "Lampiran belum tersedia di demo",
      rename: "Ganti nama percakapan",
      duplicate: "Duplikat dibuat",
      export: "Diekspor sebagai Markdown",
      clear: "Percakapan dihapus",
      profile: "Pengaturan akun",
      usage: "Penggunaan & kuota",
      logout: "Anda keluar",
    };
    if (map[action]) {
      if (action === "clear") resetThread();
      toast(map[action]);
      closeActiveMenu();
    }
  }

  function handleMessageAction(btn) {
    const act = btn.dataset.act;

    // copy a single code block
    if (act === "copy-code") {
      const pre = btn.closest("pre");
      const code = pre?.querySelector("code")?.textContent ?? "";
      copyText(code, btn);
      return;
    }

    // copy whole answer
    if (act === "copy") {
      const content = btn.closest(".message__content");
      if (!content) return;
      const text = [...content.querySelectorAll("pre code, p, li, h1, h2, h3, h4, blockquote p")]
        .map((n) => n.textContent.trim())
        .filter(Boolean)
        .join("\n\n");
      copyText(text, btn);
      return;
    }

    // regenerate
    if (act === "regenerate") {
      const msg = btn.closest(".message");
      const prev = msg?.previousElementSibling;
      if (!prev || !prev.classList.contains("message--user")) {
        toast("Tidak ada pesan untuk dibuat ulang");
        return;
      }
      const prompt = prev.querySelector(".message__bubble").textContent.trim();
      msg.remove();
      els.sendBtn.disabled = true;
      streamReply(prompt, () => {
        els.sendBtn.disabled = false;
        updateSendState();
      });
    }
  }

  function copyText(text, btn) {
    const label = btn.querySelector("span");
    const restore = () => { if (label) label.textContent = "Salin"; };
    if (!navigator.clipboard) { toast("Clipboard tidak tersedia"); return; }
    navigator.clipboard.writeText(text).then(
      () => {
        if (label) label.textContent = "Tersalin";
        setTimeout(restore, 1400);
      },
      () => toast("Gagal menyalin")
    );
  }

  function resetThread() {
    els.threadInner.innerHTML = "";
    els.welcome.hidden = false;
    els.threadInner.append(els.welcome);
    els.input.value = "";
    autosize();
    updateSendState();
    els.input.focus();
    delete els.chatTitleLabel.dataset.locked;
  }

  // ─── theme ───────────────────────────────────────────────────────
  const THEME_KEY = "devnuby-theme";

  function resolveInitialTheme() {
    const saved = readPref();
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function readPref() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }

  function writePref(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }

  function applyTheme(theme, btn) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const tBtn = btn || document.querySelector('[data-action="toggle-theme"]');
    if (tBtn) {
      tBtn.setAttribute("aria-pressed", String(theme === "dark"));
      const use = tBtn.querySelector("use");
      if (use) use.setAttribute("href", theme === "dark" ? "#i-sun" : "#i-moon");
    }
  }

  function toggleTheme(btn) {
    const cur = document.documentElement.dataset.theme;
    const next = cur === "dark" ? "light" : "dark";
    applyTheme(next, btn);
    writePref(next);
    toast(next === "dark" ? "Mode gelap" : "Mode terang");
  }

  // ─── suggestions → input ─────────────────────────────────────────
  function loadSuggestion(prompt) {
    els.input.value = prompt;
    autosize();
    updateSendState();
    els.input.focus();
  }

  // ─── wire events ─────────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const t = e.target;
    const actionBtn = t.closest("[data-action]");
    if (actionBtn) { handleAction(actionBtn); return; }
    const listBtn = t.closest("[data-model]");
    if (listBtn) { handleListAction(listBtn); return; }
    const menuBtn = t.closest('[role="menuitem"]');
    if (menuBtn) { handleMenuItem(menuBtn); return; }
    const actBtn = t.closest("[data-act]");
    if (actBtn) { handleMessageAction(actBtn); return; }
    const sugBtn = t.closest("[data-prompt]");
    if (sugBtn) { loadSuggestion(sugBtn.dataset.prompt); return; }
    const histItem = t.closest(".history__item");
    if (histItem) {
      $$(".history__item").forEach((i) => i.classList.remove("is-active"));
      histItem.classList.add("is-active");
      resetThread();
      setChatTitle(histItem.dataset.text);
      els.chatTitleLabel.dataset.locked = "1";
      const prompt = "Buka kembali: " + histItem.dataset.text;
      appendMessage("user", prompt);
      els.sendBtn.disabled = true;
      streamReply(prompt, () => {
        els.sendBtn.disabled = false;
        updateSendState();
      });
      closeSidebar();
      return;
    }
    // close any open dropdown when clicking outside
    if (activeMenu && !activeMenu.trigger.contains(t) && !activeMenu.menu.contains(t)) {
      closeActiveMenu();
    }
  });

  els.input.addEventListener("input", () => { autosize(); updateSendState(); });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(els.input.value);
    }
  });
  els.composer.addEventListener("submit", (e) => {
    e.preventDefault();
    send(els.input.value);
  });

  els.historySearch.addEventListener("input", filterHistory);

  // reasoning slider
  const reasoningSlider = $("#reasoningSlider");
  if (reasoningSlider) {
    setReasoningLabel(reasoningSlider.value);
    reasoningSlider.addEventListener("input", () => {
      setReasoningLabel(reasoningSlider.value);
    });
    reasoningSlider.addEventListener("change", () => {
      toast("Reasoning: " + $("#reasoningValue").textContent);
    });
  }

  // catalog item → select model
  document.addEventListener("click", (e) => {
    const item = e.target.closest(".catalog__item");
    if (item) {
      selectModel(item);
      return;
    }
  });

  document.addEventListener("keydown", (e) => {
    // ── dropdown keyboard navigation ──
    if (activeMenu) {
      const items = menuItems(activeMenu.menu);
      const cur = getActiveIndex(items);

      if (e.key === "Escape") {
        e.preventDefault();
        closeActiveMenu();
        activeMenu = null;
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = items.length ? (cur + 1) % items.length : 0;
        setActiveItem(items, next);
        items[next]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = items.length ? (cur - 1 + items.length) % items.length : 0;
        setActiveItem(items, prev);
        items[prev]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setActiveItem(items, 0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setActiveItem(items, items.length - 1);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        if (cur >= 0 && items[cur]) {
          e.preventDefault();
          activateItem(items[cur]);
          return;
        }
      }
      if (e.key === "Tab") {
        closeActiveMenu();
        return;
      }
    }

    if (e.key === "Escape") {
      if (els.sidebar.classList.contains("is-open")) closeSidebar();
    }
    // Ctrl/Cmd+B: toggle sidebar on desktop/mobile
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      if (isMobile()) {
        els.sidebar.classList.contains("is-open") ? closeSidebar() : openSidebar();
      } else {
        els.app.classList.contains("is-collapsed") ? expandSidebar() : collapseSidebar();
      }
    }
    // Ctrl/Cmd+K: focus search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      els.historySearch.focus();
    }
  });

  // ─── init ────────────────────────────────────────────────────────
  applyTheme(resolveInitialTheme());

  // Listen to OS-level theme changes when the user has not manually set a preference
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = (e) => {
      if (!readPref()) applyTheme(e.matches ? "dark" : "light");
    };
    if (mq.addEventListener) mq.addEventListener("change", onSchemeChange);
    else if (mq.addListener) mq.addListener(onSchemeChange);
  } catch {}

  autosize();
  updateSendState();
  updateModelSelection();
  els.input.focus();

  // Demo preview (remove before production): show one example thread
  if (location.hash === "#demo") {
    els.welcome.hidden = true;
    appendMessage("user", "Buatkan contoh endpoint REST untuk API billing");
    setChatTitle("Contoh endpoint REST untuk API billing");
    els.chatTitleLabel.dataset.locked = "1";
    els.sendBtn.disabled = true;
    streamReply("billing", () => { els.sendBtn.disabled = false; updateSendState(); });
  }
})();
