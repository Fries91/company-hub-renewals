// ==UserScript==
// @name         Hub Overlay 🏦⚔️ (Company Hub + War Hub) [Banker Theme + Briefcase Drag + Reply w/ Days Left]
// @namespace    hub-overlay
// @version      2.2.0
// @description  Company Hub: 100 Xanax renewals + records + delete. War Hub placeholder tab. Banker theme + briefcase drag. Copy reply pulls server-calculated X days left per sender_id.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      company-hub-renewals.onrender.com
// ==/UserScript==

(function () {
  "use strict";

  // ================== USER SETUP (EASY SPOT) ==================
  const BASE_URL = "https://company-hub-renewals.onrender.com"; // <-- put your Render URL
  // ============================================================

  const STORAGE_SEEN = "hub_seen_event_ids_v1";
  const STORAGE_POS  = "hub_overlay_pos_v2";
  const STORAGE_MAIN = "hub_active_main_tab_v1";  // company | war
  const STORAGE_SUB  = "hub_active_company_subtab_v1"; // renewals | records
  const POLL_MS = 15000;

  // Briefcase-like drag tuning
  const DRAG_THRESHOLD_PX = 6;
  const PANEL_GAP = 10;
  const BADGE_SIZE = 40;

  function gmGetJSON(key, fallback) {
    try {
      const raw = GM_getValue(key, "");
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }
  function gmSetJSON(key, value) { GM_setValue(key, JSON.stringify(value)); }
  function gmGetStr(key, fallback) {
    const v = GM_getValue(key, "");
    return v ? String(v) : fallback;
  }
  function gmSetStr(key, value) { GM_setValue(key, String(value)); }

  function apiGet(path, cb) {
    GM_xmlhttpRequest({
      method: "GET",
      url: BASE_URL + path + (path.includes("?") ? "&" : "?") + "cb=" + Date.now(),
      headers: { "Accept": "application/json" },
      onload: (res) => {
        try { cb(null, JSON.parse(res.responseText)); }
        catch (e) { cb(e); }
      },
      onerror: () => cb(new Error("Request failed")),
    });
  }

  function apiPost(path, body, cb) {
    GM_xmlhttpRequest({
      method: "POST",
      url: BASE_URL + path + "?cb=" + Date.now(),
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      data: JSON.stringify(body || {}),
      onload: (res) => {
        try { cb(null, JSON.parse(res.responseText)); }
        catch (e) { cb(e); }
      },
      onerror: () => cb(new Error("Request failed")),
    });
  }

  // NEW: get reply payload (server computes X days left)
  function apiGetReplyPayload(senderId, cb) {
    apiGet(`/api/reply_payload?sender_id=${encodeURIComponent(String(senderId))}`, cb);
  }

  GM_addStyle(`
    #hub-badge {
      position: fixed;
      z-index: 999999;
      width: ${BADGE_SIZE}px; height: ${BADGE_SIZE}px;
      border-radius: 12px;
      background:
        radial-gradient(120% 120% at 20% 15%, rgba(255,226,140,0.45), rgba(0,0,0,0) 45%),
        linear-gradient(180deg, #0b1a2b, #08121f);
      border: 1px solid rgba(255,219,140,0.25);
      box-shadow: 0 12px 36px rgba(0,0,0,0.45);
      display:flex; align-items:center; justify-content:center;
      color: #ffd36a;
      font-size: 20px;
      user-select: none;
      -webkit-user-select:none;
      touch-action: none;
    }

    #hub-panel {
      position: fixed;
      z-index: 999999;
      width: 332px;
      max-height: 68vh;
      overflow: auto;
      border-radius: 14px;

      background:
        linear-gradient(180deg, rgba(255,255,255,0.92), rgba(246,247,249,0.92)),
        repeating-linear-gradient(90deg, rgba(10,24,40,0.04) 0, rgba(10,24,40,0.04) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 10px);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);

      border: 1px solid rgba(10,24,40,0.18);
      box-shadow: 0 18px 55px rgba(0,0,0,0.45);
      color: #0d1622;
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    }

    #hub-panel header{
      padding: 10px 12px;
      display:flex; align-items:center; justify-content:space-between;
      border-bottom: 1px solid rgba(10,24,40,0.12);
      position: sticky; top: 0;
      background: linear-gradient(180deg, rgba(11,26,43,0.98), rgba(8,18,31,0.98));
      color: #f6f1e2;
      z-index: 5;
    }

    #hub-title{
      font-weight: 1000;
      letter-spacing: 0.6px;
      font-size: 13px;
      display:flex;
      align-items:center;
      gap:8px;
    }
    #hub-title .crest{
      width: 18px; height: 18px;
      border-radius: 6px;
      background: radial-gradient(120% 120% at 20% 20%, rgba(255,226,140,0.7), rgba(255,211,106,0.25) 55%, rgba(0,0,0,0) 70%),
                  linear-gradient(180deg, rgba(255,219,140,0.35), rgba(0,0,0,0));
      border: 1px solid rgba(255,219,140,0.35);
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15);
    }

    #hub-close{
      cursor:pointer;
      opacity:0.95;
      padding:6px 9px;
      border-radius:10px;
      border:1px solid rgba(255,219,140,0.25);
      background: rgba(255,219,140,0.08);
      color: #ffd36a;
      font-weight: 1000;
      user-select:none;
      -webkit-user-select:none;
    }

    #hub-main-tabs, #hub-sub-tabs{
      display:flex; gap:8px;
      padding: 9px 12px;
      border-bottom: 1px solid rgba(10,24,40,0.12);
      position: sticky;
      background: rgba(248,249,251,0.96);
      z-index: 4;
    }
    #hub-main-tabs{ top: 48px; }
    #hub-sub-tabs{ top: 92px; }

    .hub-tab{
      cursor:pointer;
      border: 1px solid rgba(10,24,40,0.16);
      background: rgba(255,255,255,0.7);
      color: #0b1a2b;
      padding: 6px 9px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 1000;
      white-space: nowrap;
      user-select:none;
      -webkit-user-select:none;
    }
    .hub-tab.active{
      color: #0b1a2b;
      border-color: rgba(255,211,106,0.55);
      background: linear-gradient(180deg, rgba(255,226,140,0.40), rgba(255,211,106,0.14));
      box-shadow: inset 0 0 0 1px rgba(255,211,106,0.18);
    }

    #hub-body{ padding: 10px 12px; }

    .hub-card{
      border: 1px solid rgba(10,24,40,0.14);
      border-radius: 12px;
      padding: 10px;
      margin-bottom: 10px;
      background: linear-gradient(180deg, rgba(255,255,255,0.78), rgba(245,246,248,0.78));
      box-shadow: 0 10px 22px rgba(0,0,0,0.10);
    }
    .hub-muted{ opacity:0.72; font-size: 12px; }
    .hub-big{ font-weight: 1100; margin: 6px 0; font-size: 13px; }

    .hub-btns{ display:flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .hub-btn{
      cursor:pointer;
      border: 1px solid rgba(10,24,40,0.16);
      background: rgba(255,255,255,0.72);
      color: #0b1a2b;
      padding: 6px 9px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 1000;
      user-select:none;
      -webkit-user-select:none;
    }
    .hub-btn.good{
      border-color: rgba(255,211,106,0.55);
      background: linear-gradient(180deg, rgba(255,226,140,0.40), rgba(255,211,106,0.14));
    }
    .hub-btn.bad{
      border-color: rgba(208,70,70,0.35);
      background: linear-gradient(180deg, rgba(255,210,210,0.55), rgba(255,235,235,0.55));
      color: #7b0f0f;
    }

    .hub-toast{
      position: fixed;
      z-index: 1000000;
      left: 50%;
      transform: translateX(-50%);
      bottom: 18px;
      background: linear-gradient(180deg, rgba(11,26,43,0.98), rgba(8,18,31,0.98));
      color: #ffd36a;
      border: 1px solid rgba(255,219,140,0.25);
      border-radius: 12px;
      padding: 10px 12px;
      box-shadow: 0 14px 40px rgba(0,0,0,0.50);
      max-width: 92vw;
      font-weight: 1000;
    }

    #hub-panel::-webkit-scrollbar { width: 10px; }
    #hub-panel::-webkit-scrollbar-thumb { background: rgba(10,24,40,0.20); border-radius: 10px; }
  `);

  const badge = document.createElement("div");
  badge.id = "hub-badge";
  badge.textContent = "🏦";
  document.body.appendChild(badge);

  const panel = document.createElement("div");
  panel.id = "hub-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <header>
      <div id="hub-title"><span class="crest"></span><span id="hub-title-text">Hub</span></div>
      <div id="hub-close">✕</div>
    </header>

    <div id="hub-main-tabs">
      <div class="hub-tab" data-main="company">Company Hub</div>
      <div class="hub-tab" data-main="war">War Hub</div>
    </div>

    <div id="hub-sub-tabs">
      <div class="hub-tab" data-sub="renewals">Renewals</div>
      <div class="hub-tab" data-sub="records">Records</div>
    </div>

    <div id="hub-body"><div class="hub-muted">Loading…</div></div>
  `;
  document.body.appendChild(panel);

  panel.querySelector("#hub-close").addEventListener("click", () => (panel.style.display = "none"));

  function showToast(msg) {
    const t = document.createElement("div");
    t.className = "hub-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function loadPos() {
    const p = gmGetJSON(STORAGE_POS, { x: 14, y: 160 });
    return { x: Math.max(6, p.x), y: Math.max(6, p.y) };
  }
  function savePos(x, y) { gmSetJSON(STORAGE_POS, { x, y }); }

  function applyPos(xy) {
    const p = xy || loadPos();
    const maxX = Math.max(6, window.innerWidth - BADGE_SIZE - 6);
    const maxY = Math.max(6, window.innerHeight - BADGE_SIZE - 6);

    const x = clamp(p.x, 6, maxX);
    const y = clamp(p.y, 6, maxY);

    badge.style.left = x + "px";
    badge.style.top = y + "px";

    const panelW = 332;
    const rightX = x + BADGE_SIZE + PANEL_GAP;
    const leftX  = x - panelW - PANEL_GAP;

    const px = (rightX + panelW <= window.innerWidth - 6) ? rightX : Math.max(6, leftX);
    const py = clamp(y, 6, Math.max(6, window.innerHeight - 120));

    panel.style.left = px + "px";
    panel.style.top  = py + "px";
  }

  applyPos();
  window.addEventListener("resize", () => applyPos(loadPos()));

  let drag = null;
  let didDrag = false;

  badge.addEventListener("pointerdown", (e) => {
    drag = { startX: e.clientX, startY: e.clientY, pos: loadPos(), pid: e.pointerId };
    didDrag = false;
    badge.setPointerCapture(e.pointerId);
  });

  badge.addEventListener("pointermove", (e) => {
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!didDrag && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
      didDrag = true;
    }

    const x = Math.round(drag.pos.x + dx);
    const y = Math.round(drag.pos.y + dy);
    applyPos({ x, y });
  });

  function endDrag() {
    if (!drag) return;
    const x = parseInt(badge.style.left, 10) || 14;
    const y = parseInt(badge.style.top, 10) || 160;
    savePos(x, y);
    drag = null;
  }

  badge.addEventListener("pointerup", () => {
    endDrag();
    if (didDrag) return;
    panel.style.display = (panel.style.display === "none") ? "block" : "none";
    if (panel.style.display !== "none") render();
  });

  badge.addEventListener("pointercancel", endDrag);

  panel.querySelector("#hub-title").addEventListener("click", () => {
    panel.style.display = "none";
  });

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString(); } catch { return iso || ""; }
  }

  function getMain() { return gmGetStr(STORAGE_MAIN, "company"); }
  function setMain(v) { gmSetStr(STORAGE_MAIN, v); updateTabsUI(); render(); }
  function getSub() { return gmGetStr(STORAGE_SUB, "renewals"); }
  function setSub(v) { gmSetStr(STORAGE_SUB, v); updateTabsUI(); render(); }

  panel.querySelectorAll("[data-main]").forEach(el => el.addEventListener("click", () => setMain(el.dataset.main)));
  panel.querySelectorAll("[data-sub]").forEach(el => el.addEventListener("click", () => setSub(el.dataset.sub)));

  function updateTabsUI() {
    const main = getMain();
    const sub = getSub();

    panel.querySelectorAll("[data-main]").forEach(el => el.classList.toggle("active", el.dataset.main === main));

    const subBar = panel.querySelector("#hub-sub-tabs");
    if (main === "company") {
      subBar.style.display = "flex";
      panel.querySelectorAll("[data-sub]").forEach(el => el.classList.toggle("active", el.dataset.sub === sub));
    } else {
      subBar.style.display = "none";
    }

    badge.textContent = (main === "company") ? "🏦" : "⚔️";
    panel.querySelector("#hub-title-text").textContent = (main === "company") ? "Company Hub" : "War Hub";
  }
  updateTabsUI();

  let lastState = null;

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function renderCompany(data) {
    const body = panel.querySelector("#hub-body");
    const sub = getSub();
    const renewDays = data.renew_days || 60;

    const open = data.renewals_open || [];
    const records = data.renewals_records || [];
    const list = (sub === "records") ? records : open;

    if (!list.length) {
      body.innerHTML = `<div class="hub-muted">${sub === "records" ? "No records yet." : "No new renewals right now."}</div>`;
      return;
    }

    body.innerHTML = list.map(r => {
      const who = `${r.sender_name || "Unknown"}${r.sender_id ? " [" + r.sender_id + "]" : ""}`;
      const doneBadge = r.done
        ? `<div class="hub-muted">Status: ✅ Done</div>`
        : `<div class="hub-muted">Status: ⏳ Open</div>`;
      const doneBtn = (!r.done && sub === "renewals") ? `<button class="hub-btn good hub-done">Renewed ✅</button>` : "";
      const deleteBtn = (sub === "records") ? `<button class="hub-btn bad hub-del">Delete</button>` : "";
      const doneLine = r.done ? `<div class="hub-muted">Marked done: ${fmtDate(r.done_at || "")}</div>` : "";

      // NEW: "Message" button (opens compose URL with the exact payload available)
      const msgBtn = r.sender_id ? `<button class="hub-btn good hub-msg">Message</button>` : "";

      return `
        <div class="hub-card" data-eid="${r.event_id}">
          <div class="hub-big">🏦 Renewal posted — +${renewDays} days</div>
          <div class="hub-muted">Received: ${fmtDate(r.received_at)}</div>
          <div class="hub-muted">Client: ${who}</div>
          <div class="hub-muted">Deposit: ${r.qty} Xanax</div>
          <div class="hub-muted">Valid until: ${fmtDate(r.renewed_until)}</div>
          ${doneBadge}
          ${doneLine}
          <div class="hub-btns">
            <button class="hub-btn hub-copy">Copy reply (X days)</button>
            ${msgBtn}
            <button class="hub-btn hub-open">Open profile</button>
            ${doneBtn}
            ${deleteBtn}
          </div>
        </div>
      `;
    }).join("");

    body.querySelectorAll(".hub-card").forEach(card => {
      const eid = card.dataset.eid;
      const r = list.find(x => x.event_id === eid);
      if (!r) return;

      // ✅ Copy reply now pulls /api/reply_payload so X days left is accurate
      card.querySelector(".hub-copy").addEventListener("click", () => {
        if (!r.sender_id) return showToast("No sender ID found.");

        showToast("Fetching reply…");
        apiGetReplyPayload(r.sender_id, async (err, payload) => {
          if (err || !payload || !payload.ok) return showToast("Could not get reply payload.");

          const who = `${r.sender_name || "Unknown"}${r.sender_id ? " [" + r.sender_id + "]" : ""}`;
          const txt = `Hi ${who},\n\n${payload.message_body}\n—`;

          const ok = await copyToClipboard(txt);
          if (ok) showToast(`Reply copied ✅ (${payload.remaining_days ?? "?"} day(s) left)`);
          else showToast("Clipboard blocked — copy manually.");
        });
      });

      // ✅ Message button opens compose + also copies message body
      const msgBtn = card.querySelector(".hub-msg");
      if (msgBtn) {
        msgBtn.addEventListener("click", () => {
          showToast("Preparing message…");
          apiGetReplyPayload(r.sender_id, async (err, payload) => {
            if (err || !payload || !payload.ok) return showToast("Could not get reply payload.");

            const who = `${r.sender_name || "Unknown"}${r.sender_id ? " [" + r.sender_id + "]" : ""}`;
            const txt = `Hi ${who},\n\n${payload.message_body}\n—`;
            await copyToClipboard(txt); // best effort
            if (payload.compose_url) window.open(payload.compose_url, "_blank");
            showToast(`Message ready ✅ (${payload.remaining_days ?? "?"} day(s) left)`);
          });
        });
      }

      card.querySelector(".hub-open").addEventListener("click", () => {
        if (!r.sender_id) return showToast("No sender ID found.");
        window.open(`https://www.torn.com/profiles.php?XID=${r.sender_id}`, "_blank");
      });

      const doneBtn = card.querySelector(".hub-done");
      if (doneBtn) {
        doneBtn.addEventListener("click", () => {
          apiPost("/api/renewals/done", { event_id: eid }, (err, resp) => {
            if (err || !resp || !resp.ok) return showToast("Could not mark done.");
            showToast("Marked done ✅ Moved to Records.");
            poll(true);
          });
        });
      }

      const delBtn = card.querySelector(".hub-del");
      if (delBtn) {
        delBtn.addEventListener("click", () => {
          apiPost("/api/renewals/delete", { event_id: eid }, (err, resp) => {
            if (err || !resp || !resp.ok) return showToast("Could not delete record.");
            showToast("Deleted ✅");
            poll(true);
          });
        });
      }
    });
  }

  function renderWar() {
    const body = panel.querySelector("#hub-body");
    body.innerHTML = `
      <div class="hub-card">
        <div class="hub-big">⚔️ War Hub</div>
        <div class="hub-muted">Coming soon — paste your War Hub overlay content here.</div>
      </div>
    `;
  }

  function render() {
    const body = panel.querySelector("#hub-body");
    const data = lastState;
    if (!data) {
      body.innerHTML = `<div class="hub-muted">Loading…</div>`;
      return;
    }

    updateTabsUI();
    if (getMain() === "company") renderCompany(data);
    else renderWar();
  }

  function checkForNewToast(openRenewals) {
    const seen = new Set(gmGetJSON(STORAGE_SEEN, []));
    let newest = null;

    for (const r of openRenewals) {
      if (!seen.has(r.event_id)) { newest = r; break; }
    }

    if (newest) {
      const who = `${newest.sender_name || "Unknown"}${newest.sender_id ? " [" + newest.sender_id + "]" : ""}`;
      showToast(`🏦 Renewal received: 100 Xanax from ${who}`);
      seen.add(newest.event_id);
      gmSetJSON(STORAGE_SEEN, Array.from(seen).slice(-500));
    }
  }

  function poll(forceRender) {
    apiGet("/state", (err, data) => {
      if (err || !data) return;
      lastState = data;

      checkForNewToast(data.renewals_open || []);
      if (forceRender || panel.style.display !== "none") render();
    });
  }

  poll(true);
  setInterval(() => poll(false), POLL_MS);
})();
