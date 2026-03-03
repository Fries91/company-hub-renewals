// ==UserScript==
// @name         Hub Overlay 🏢⚔️ (Company Hub + War Hub)
// @namespace    hub-overlay
// @version      2.0.0
// @description  Company Hub: 100 Xanax renewals + records + delete. War Hub placeholder tab.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      https://company-hub-renewals.onrender.com
// ==/UserScript==

(function () {
  "use strict";

  // ================== USER SETUP (EASY SPOT) ==================
  const BASE_URL = "https://company-hub-renewals.onrender.com"; // <-- put your Render URL
  // ============================================================

  const STORAGE_SEEN = "hub_seen_event_ids_v1";
  const STORAGE_POS  = "hub_overlay_pos_v1";
  const STORAGE_MAIN = "hub_active_main_tab_v1";  // company | war
  const STORAGE_SUB  = "hub_active_company_subtab_v1"; // renewals | records
  const POLL_MS = 15000;

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

  GM_addStyle(`
    #hub-badge {
      position: fixed;
      z-index: 999999;
      width: 44px; height: 44px;
      border-radius: 12px;
      background: linear-gradient(180deg, #111, #1b1b1b);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      display:flex; align-items:center; justify-content:center;
      color: #ffd36a;
      font-size: 22px;
      user-select: none;
    }
    #hub-panel {
      position: fixed;
      z-index: 999999;
      width: 360px;
      max-height: 70vh;
      overflow: auto;
      border-radius: 14px;
      background: rgba(15,15,15,0.94);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 14px 45px rgba(0,0,0,0.5);
      color: #eee;
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    }
    #hub-panel header{
      padding: 10px 12px;
      display:flex; align-items:center; justify-content:space-between;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      position: sticky; top: 0;
      background: rgba(15,15,15,0.98);
      z-index: 5;
    }
    #hub-title{ font-weight: 900; letter-spacing:0.3px; }
    #hub-close{ cursor:pointer; opacity:0.9; padding:6px 9px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); }

    #hub-main-tabs, #hub-sub-tabs{
      display:flex; gap:8px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      position: sticky;
      background: rgba(15,15,15,0.98);
      z-index: 4;
    }
    #hub-main-tabs{ top: 48px; }
    #hub-sub-tabs{ top: 96px; }

    .hub-tab{
      cursor:pointer;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.22);
      color: #eee;
      padding: 7px 10px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 900;
      opacity: 0.9;
      white-space: nowrap;
    }
    .hub-tab.active{
      color: #ffd36a;
      border-color: rgba(255,211,106,0.35);
      background: rgba(255,211,106,0.08);
      opacity: 1;
    }

    #hub-body{ padding: 10px 12px; margin-top: 0; }
    .hub-card{
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      padding: 10px;
      margin-bottom: 10px;
      background: rgba(255,255,255,0.04);
    }
    .hub-muted{ opacity:0.75; font-size: 12px; }
    .hub-big{ font-weight: 900; margin: 6px 0; }
    .hub-btns{ display:flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .hub-btn{
      cursor:pointer;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.22);
      color: #eee;
      padding: 7px 9px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 900;
    }
    .hub-btn.good{
      color:#ffd36a;
      border-color: rgba(255,211,106,0.35);
      background: rgba(255,211,106,0.08);
    }
    .hub-btn.bad{
      color:#ff8a8a;
      border-color: rgba(255,138,138,0.35);
      background: rgba(255,138,138,0.08);
    }
    .hub-toast{
      position: fixed;
      z-index: 1000000;
      left: 50%;
      transform: translateX(-50%);
      bottom: 18px;
      background: rgba(15,15,15,0.96);
      color: #ffd36a;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 12px;
      padding: 10px 12px;
      box-shadow: 0 14px 40px rgba(0,0,0,0.5);
      max-width: 92vw;
      font-weight: 900;
    }
  `);

  const badge = document.createElement("div");
  badge.id = "hub-badge";
  badge.textContent = "🏢";
  document.body.appendChild(badge);

  const panel = document.createElement("div");
  panel.id = "hub-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <header>
      <div id="hub-title">Hub</div>
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

  function loadPos() {
    const p = gmGetJSON(STORAGE_POS, { x: 14, y: 160 });
    return { x: Math.max(6, p.x), y: Math.max(6, p.y) };
  }
  function savePos(x, y) { gmSetJSON(STORAGE_POS, { x, y }); }
  function applyPos() {
    const p = loadPos();
    badge.style.left = p.x + "px";
    badge.style.top = p.y + "px";
    panel.style.left = (p.x + 54) + "px";
    panel.style.top = p.y + "px";
  }
  applyPos();

  let drag = null;
  badge.addEventListener("pointerdown", (e) => {
    drag = { startX: e.clientX, startY: e.clientY, pos: loadPos() };
    badge.setPointerCapture(e.pointerId);
  });
  badge.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const x = Math.round(drag.pos.x + (e.clientX - drag.startX));
    const y = Math.round(drag.pos.y + (e.clientY - drag.startY));
    badge.style.left = x + "px";
    badge.style.top = y + "px";
    panel.style.left = (x + 54) + "px";
    panel.style.top = y + "px";
  });
  badge.addEventListener("pointerup", () => {
    if (!drag) return;
    savePos(parseInt(badge.style.left, 10) || 14, parseInt(badge.style.top, 10) || 160);
    drag = null;
  });

  let lastDown = 0;
  badge.addEventListener("pointerdown", () => (lastDown = Date.now()));
  badge.addEventListener("click", () => {
    if (Date.now() - lastDown > 250) return;
    panel.style.display = (panel.style.display === "none") ? "block" : "none";
    if (panel.style.display !== "none") render();
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

    badge.textContent = (main === "company") ? "🏢" : "⚔️";
    panel.querySelector("#hub-title").textContent = (main === "company") ? "Company Hub" : "War Hub";
  }
  updateTabsUI();

  let lastState = null;

  function renderCompany(data) {
    const body = panel.querySelector("#hub-body");
    const sub = getSub();
    const renewDays = data.renew_days || 45;

    const open = data.renewals_open || [];
    const records = data.renewals_records || [];
    const list = (sub === "records") ? records : open;

    const replyText = `Renewed for another ${renewDays} days thank you for using my service's other to come check out my profile signature for updates of hubs.`;

    if (!list.length) {
      body.innerHTML = `<div class="hub-muted">${sub === "records" ? "No records yet." : "No new renewals right now."}</div>`;
      return;
    }

    body.innerHTML = list.map(r => {
      const who = `${r.sender_name || "Unknown"}${r.sender_id ? " [" + r.sender_id + "]" : ""}`;
      const doneBadge = r.done ? `<div class="hub-muted">Status: ✅ Done</div>` : `<div class="hub-muted">Status: ⏳ Open</div>`;
      const doneBtn = (!r.done && sub === "renewals") ? `<button class="hub-btn good hub-done">Renewed ✅</button>` : "";
      const deleteBtn = (sub === "records") ? `<button class="hub-btn bad hub-del">Delete</button>` : "";
      const doneLine = r.done ? `<div class="hub-muted">Marked done: ${fmtDate(r.done_at || "")}</div>` : "";

      return `
        <div class="hub-card" data-eid="${r.event_id}">
          <div class="hub-big">Company hub renewal payment — another ${renewDays} days</div>
          <div class="hub-muted">Date: ${fmtDate(r.received_at)}</div>
          <div class="hub-muted">Received by: ${who}</div>
          <div class="hub-muted">Amount: ${r.qty} Xanax</div>
          <div class="hub-muted">Renewed until: ${fmtDate(r.renewed_until)}</div>
          ${doneBadge}
          ${doneLine}
          <div class="hub-btns">
            <button class="hub-btn hub-copy">Copy reply</button>
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

      card.querySelector(".hub-copy").addEventListener("click", async () => {
        const who = `${r.sender_name || "Unknown"}${r.sender_id ? " [" + r.sender_id + "]" : ""}`;
        const txt = `Hi ${who},\n\n${replyText}\n\n—`;
        try {
          await navigator.clipboard.writeText(txt);
          showToast("Reply copied ✅");
        } catch {
          showToast("Clipboard blocked — copy manually.");
        }
      });

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
          // no confirmation popups to keep it clean; uncomment if you want confirm:
          // if (!confirm("Delete this record permanently?")) return;

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
        <div class="hub-big">War Hub</div>
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
      showToast(`Renewal received: 100 Xanax from ${who}`);
      seen.add(newest.event_id);
      gmSetJSON(STORAGE_SEEN, Array.from(seen).slice(-500));
    }
  }

  function poll(forceRender) {
    apiGet("/state", (err, data) => {
      if (err || !data) return;
      lastState = data;

      // only toast on open renewals
      checkForNewToast(data.renewals_open || []);

      if (forceRender || panel.style.display !== "none") render();
    });
  }

  // start
  poll(true);
  setInterval(() => poll(false), POLL_MS);
})();
