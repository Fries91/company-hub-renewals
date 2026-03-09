// ==UserScript==
// @name         Hub Overlay 🏦⚔️ (Company Hub + War Hub) [Banker Theme + Briefcase Drag + Bubble Alerts]
// @namespace    hub-overlay
// @version      2.5.0
// @description  Company Hub: 50 Xanax renewals for 45 days + client names + records + delete + 5-day warning alerts + badge bubble.
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

  // ================== USER SETUP ==================
  const BASE_URL = "https://company-hub-renewals.onrender.com";
  // =================================================

  const STORAGE_SEEN = "hub_seen_event_ids_v2";
  const STORAGE_SEEN_ALERTS = "hub_seen_alert_ids_v2";
  const STORAGE_POS = "hub_overlay_pos_v3";
  const STORAGE_MAIN = "hub_active_main_tab_v2";     // company | war
  const STORAGE_SUB = "hub_active_company_subtab_v2"; // renewals | clients | records
  const POLL_MS = 15000;

  const DRAG_THRESHOLD_PX = 6;
  const PANEL_GAP = 10;
  const BADGE_SIZE = 40;
  const PANEL_WIDTH = 350;

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

  function apiGetReplyPayload(senderId, cb) {
    apiGet(`/api/reply_payload?sender_id=${encodeURIComponent(String(senderId))}`, cb);
  }
  function apiGetWarnPayload(senderId, cb) {
    apiGet(`/api/warn_payload?sender_id=${encodeURIComponent(String(senderId))}`, cb);
  }
  function apiAckAlert(alertId, cb) {
    apiPost("/api/alerts/ack", { alert_id: String(alertId) }, cb);
  }

  GM_addStyle(`
    #hub-badge {
      position: fixed;
      z-index: 999999;
      width: ${BADGE_SIZE}px;
      height: ${BADGE_SIZE}px;
      border-radius: 12px;
      background:
        radial-gradient(120% 120% at 20% 15%, rgba(255,226,140,0.45), rgba(0,0,0,0) 45%),
        linear-gradient(180deg, #0b1a2b, #08121f);
      border: 1px solid rgba(255,219,140,0.25);
      box-shadow: 0 12px 36px rgba(0,0,0,0.45);
      display:flex;
      align-items:center;
      justify-content:center;
      color: #ffd36a;
      font-size: 20px;
      user-select: none;
      -webkit-user-select:none;
      touch-action: none;
      cursor: pointer;
    }

    #hub-bubble{
      position:absolute;
      top:-7px;
      right:-7px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      display:none;
      align-items:center;
      justify-content:center;
      font-size: 11px;
      font-weight: 1000;
      letter-spacing: 0.2px;
      border: 1px solid rgba(255,255,255,0.55);
      box-shadow: 0 10px 18px rgba(0,0,0,0.35);
      user-select:none;
      -webkit-user-select:none;
      transform: translateZ(0);
      pointer-events:none;
    }
    #hub-bubble.hub-bubble-renew{
      background: linear-gradient(180deg, rgba(255,226,140,0.98), rgba(255,211,106,0.92));
      color: #0b1a2b;
      border-color: rgba(10,24,40,0.35);
    }
    #hub-bubble.hub-bubble-warn{
      background: linear-gradient(180deg, rgba(255,120,120,0.98), rgba(208,70,70,0.92));
      color: #fff;
      border-color: rgba(255,255,255,0.35);
    }

    #hub-panel {
      position: fixed;
      z-index: 999999;
      width: ${PANEL_WIDTH}px;
      max-height: 72vh;
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
      display:flex;
      align-items:center;
      justify-content:space-between;
      border-bottom: 1px solid rgba(10,24,40,0.12);
      position: sticky;
      top: 0;
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
      cursor:pointer;
      user-select:none;
      -webkit-user-select:none;
    }

    #hub-title .crest{
      width: 18px;
      height: 18px;
      border-radius: 6px;
      background:
        radial-gradient(120% 120% at 20% 20%, rgba(255,226,140,0.7), rgba(255,211,106,0.25) 55%, rgba(0,0,0,0) 70%),
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

    #hub-main-tabs,
    #hub-sub-tabs{
      display:flex;
      gap:8px;
      padding: 9px 12px;
      border-bottom: 1px solid rgba(10,24,40,0.12);
      position: sticky;
      background: rgba(248,249,251,0.96);
      z-index: 4;
      flex-wrap: wrap;
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

    .hub-muted{
      opacity:0.75;
      font-size: 12px;
      line-height: 1.35;
      word-break: break-word;
    }

    .hub-big{
      font-weight: 1100;
      margin: 6px 0;
      font-size: 13px;
      line-height: 1.35;
      word-break: break-word;
    }

    .hub-grid{
      display:grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 10px;
    }

    .hub-mini{
      border: 1px solid rgba(10,24,40,0.12);
      border-radius: 12px;
      padding: 9px;
      background: linear-gradient(180deg, rgba(255,255,255,0.86), rgba(246,247,249,0.86));
    }

    .hub-mini .k{
      font-size: 11px;
      opacity: 0.72;
      margin-bottom: 4px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    .hub-mini .v{
      font-size: 15px;
      font-weight: 1100;
      color: #0b1a2b;
    }

    .hub-btns{
      display:flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }

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

    .hub-status{
      display:inline-flex;
      align-items:center;
      gap:6px;
      padding:4px 8px;
      border-radius:999px;
      font-size:11px;
      font-weight:1000;
      margin-top:6px;
      border:1px solid rgba(10,24,40,0.12);
      background: rgba(255,255,255,0.72);
    }

    .hub-status.active{
      color:#0d4b2a;
      border-color: rgba(24,150,88,0.25);
      background: linear-gradient(180deg, rgba(215,255,231,0.82), rgba(239,255,246,0.82));
    }

    .hub-status.expired{
      color:#7b0f0f;
      border-color: rgba(208,70,70,0.25);
      background: linear-gradient(180deg, rgba(255,223,223,0.82), rgba(255,243,243,0.82));
    }

    .hub-toolbar{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin-bottom: 10px;
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
      word-break: break-word;
    }

    #hub-panel::-webkit-scrollbar { width: 10px; }
    #hub-panel::-webkit-scrollbar-thumb {
      background: rgba(10,24,40,0.20);
      border-radius: 10px;
    }
  `);

  const badge = document.createElement("div");
  badge.id = "hub-badge";
  badge.textContent = "🏦";

  const bubble = document.createElement("div");
  bubble.id = "hub-bubble";
  bubble.textContent = "";
  badge.appendChild(bubble);

  document.body.appendChild(badge);

  const panel = document.createElement("div");
  panel.id = "hub-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <header>
      <div id="hub-title"><span class="crest"></span><span id="hub-title-text">Company Hub</span></div>
      <div id="hub-close">✕</div>
    </header>

    <div id="hub-main-tabs">
      <div class="hub-tab" data-main="company">Company Hub</div>
      <div class="hub-tab" data-main="war">War Hub</div>
    </div>

    <div id="hub-sub-tabs">
      <div class="hub-tab" data-sub="renewals">Renewals</div>
      <div class="hub-tab" data-sub="clients">Clients</div>
      <div class="hub-tab" data-sub="records">Records</div>
    </div>

    <div id="hub-body"><div class="hub-muted">Loading…</div></div>
  `;
  document.body.appendChild(panel);

  panel.querySelector("#hub-close").addEventListener("click", () => (panel.style.display = "none"));
  panel.querySelector("#hub-title").addEventListener("click", () => (panel.style.display = "none"));

  function showToast(msg) {
    const t = document.createElement("div");
    t.className = "hub-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  function updateBubble(openRenewalsCount, openAlertsCount) {
    const r = Math.max(0, parseInt(openRenewalsCount || 0, 10));
    const a = Math.max(0, parseInt(openAlertsCount || 0, 10));
    const total = r + a;

    if (total <= 0) {
      bubble.style.display = "none";
      bubble.textContent = "";
      bubble.classList.remove("hub-bubble-renew", "hub-bubble-warn");
      bubble.title = "";
      return;
    }

    bubble.style.display = "flex";
    bubble.textContent = total > 99 ? "99+" : String(total);
    bubble.classList.remove("hub-bubble-renew", "hub-bubble-warn");
    if (a > 0) bubble.classList.add("hub-bubble-warn");
    else bubble.classList.add("hub-bubble-renew");
    bubble.title = `${r} renewal(s) open, ${a} warning(s) open`;
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

    const rightX = x + BADGE_SIZE + PANEL_GAP;
    const leftX = x - PANEL_WIDTH - PANEL_GAP;
    const px = (rightX + PANEL_WIDTH <= window.innerWidth - 6) ? rightX : Math.max(6, leftX);
    const py = clamp(y, 6, Math.max(6, window.innerHeight - 120));

    panel.style.left = px + "px";
    panel.style.top = py + "px";
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

  function fmtDate(iso) {
    try {
      return iso ? new Date(iso).toLocaleString() : "";
    } catch {
      return iso || "";
    }
  }

  function getMain() { return gmGetStr(STORAGE_MAIN, "company"); }
  function setMain(v) { gmSetStr(STORAGE_MAIN, v); updateTabsUI(); render(); }
  function getSub() { return gmGetStr(STORAGE_SUB, "renewals"); }
  function setSub(v) { gmSetStr(STORAGE_SUB, v); updateTabsUI(); render(); }

  panel.querySelectorAll("[data-main]").forEach((el) => {
    el.addEventListener("click", () => setMain(el.dataset.main));
  });
  panel.querySelectorAll("[data-sub]").forEach((el) => {
    el.addEventListener("click", () => setSub(el.dataset.sub));
  });

  function updateTabsUI() {
    const main = getMain();
    const sub = getSub();

    panel.querySelectorAll("[data-main]").forEach((el) => {
      el.classList.toggle("active", el.dataset.main === main);
    });

    const subBar = panel.querySelector("#hub-sub-tabs");
    if (main === "company") {
      subBar.style.display = "flex";
      panel.querySelectorAll("[data-sub]").forEach((el) => {
        el.classList.toggle("active", el.dataset.sub === sub);
      });
    } else {
      subBar.style.display = "none";
    }

    badge.textContent = (main === "company") ? "🏦" : "⚔️";
    badge.appendChild(bubble);

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

  function renderTopSummary(data) {
    const openRenewals = (data.renewals_open || []).length;
    const records = (data.renewals_records || []).length;
    const alerts = (data.alerts_open || []).length;
    const clients = (data.clients || []).length;
    const renewQty = data.renew_qty_required || 50;
    const renewDays = data.renew_days || 45;

    return `
      <div class="hub-grid">
        <div class="hub-mini">
          <div class="k">Renewal Rule</div>
          <div class="v">${renewQty} Xanax</div>
        </div>
        <div class="hub-mini">
          <div class="k">Days Added</div>
          <div class="v">${renewDays}</div>
        </div>
        <div class="hub-mini">
          <div class="k">Open Renewals</div>
          <div class="v">${openRenewals}</div>
        </div>
        <div class="hub-mini">
          <div class="k">Warnings</div>
          <div class="v">${alerts}</div>
        </div>
        <div class="hub-mini">
          <div class="k">Clients</div>
          <div class="v">${clients}</div>
        </div>
        <div class="hub-mini">
          <div class="k">Records</div>
          <div class="v">${records}</div>
        </div>
      </div>
      <div class="hub-card">
        <div class="hub-big">🏦 Company Hub Manager</div>
        <div class="hub-muted">Registers when you receive at least <b>${renewQty} Xanax</b> from any player and adds <b>${renewDays} days</b> to that player’s hub access.</div>
        <div class="hub-muted" style="margin-top:6px;">Last poll: ${data.last_poll_at ? fmtDate(data.last_poll_at) : "Waiting..."}</div>
        <div class="hub-muted">Server status: ${data.last_error ? "⚠️ " + data.last_error : "✅ Running"}</div>
      </div>
    `;
  }

  function renderAlerts(data) {
    const alerts = (data.alerts_open || []);
    if (!alerts.length) return "";

    const clients = data.clients || [];
    const nameById = new Map(clients.map((c) => [String(c.sender_id || ""), c.sender_name || "Unknown"]));

    return `
      <div class="hub-card">
        <div class="hub-big">⚠️ Warnings</div>
        <div class="hub-muted">Players nearing expiry. Ack after you’ve handled it.</div>
        ${alerts.map((a) => {
          const sid = String(a.sender_id || "");
          const sname = nameById.get(sid) || "Unknown";
          const left = (a.remaining_days ?? "?");
          return `
            <div class="hub-card" style="margin-top:10px;" data-alertid="${a.alert_id}" data-sender="${sid}">
              <div class="hub-big">⚠️ ${left} day(s) left — Hub access</div>
              <div class="hub-muted">Client: ${sname}${sid ? " [" + sid + "]" : ""}</div>
              <div class="hub-muted">Valid until: ${fmtDate(a.renewed_until)}</div>
              <div class="hub-btns">
                <button class="hub-btn good hub-warn-copy">Copy warning</button>
                <button class="hub-btn good hub-warn-msg">Message</button>
                <button class="hub-btn bad hub-ack">Ack</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function wireAlertButtons(container) {
    container.querySelectorAll("[data-alertid]").forEach((card) => {
      const alertId = card.getAttribute("data-alertid");
      const senderId = card.getAttribute("data-sender");

      const copyBtn = card.querySelector(".hub-warn-copy");
      const msgBtn = card.querySelector(".hub-warn-msg");
      const ackBtn = card.querySelector(".hub-ack");

      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          if (!senderId) return showToast("No sender ID.");
          showToast("Fetching warning...");
          apiGetWarnPayload(senderId, async (err, payload) => {
            if (err || !payload || !payload.ok) return showToast("Could not get warning payload.");
            const ok = await copyToClipboard(payload.message_body);
            showToast(ok ? "Warning copied ✅" : "Clipboard blocked — copy manually.");
          });
        });
      }

      if (msgBtn) {
        msgBtn.addEventListener("click", () => {
          if (!senderId) return showToast("No sender ID.");
          showToast("Preparing message...");
          apiGetWarnPayload(senderId, async (err, payload) => {
            if (err || !payload || !payload.ok) return showToast("Could not get warning payload.");
            await copyToClipboard(payload.message_body);
            if (payload.compose_url) window.open(payload.compose_url, "_blank");
            showToast("Message ready ✅");
          });
        });
      }

      if (ackBtn) {
        ackBtn.addEventListener("click", () => {
          apiAckAlert(alertId, (err, resp) => {
            if (err || !resp || !resp.ok) return showToast("Could not ack alert.");
            showToast("Acked ✅");
            poll(true);
          });
        });
      }
    });
  }

  function renderCompanyRenewals(data) {
    const body = panel.querySelector("#hub-body");
    const renewDays = data.renew_days || 45;
    const list = data.renewals_open || [];
    const summaryHTML = renderTopSummary(data);
    const alertsHTML = renderAlerts(data);

    if (!list.length && !alertsHTML) {
      body.innerHTML = `${summaryHTML}<div class="hub-muted">No new renewals right now.</div>`;
      return;
    }

    const listHTML = list.map((r) => {
      const who = `${r.sender_name || "Unknown"}${r.sender_id ? " [" + r.sender_id + "]" : ""}`;
      const msgBtn = r.sender_id ? `<button class="hub-btn good hub-msg">Message</button>` : "";

      return `
        <div class="hub-card" data-eid="${r.event_id}">
          <div class="hub-big">🏦 Renewal posted — +${renewDays} days</div>
          <div class="hub-muted">Received: ${fmtDate(r.received_at)}</div>
          <div class="hub-muted">Client: ${who}</div>
          <div class="hub-muted">Deposit: ${r.qty} Xanax</div>
          <div class="hub-muted">Valid until: ${fmtDate(r.renewed_until)}</div>
          <div class="hub-status active">⏳ Open renewal</div>
          <div class="hub-btns">
            <button class="hub-btn hub-copy">Copy reply</button>
            ${msgBtn}
            <button class="hub-btn hub-open">Open profile</button>
            <button class="hub-btn good hub-done">Renewed ✅</button>
          </div>
        </div>
      `;
    }).join("");

    body.innerHTML = `${summaryHTML}${alertsHTML}${listHTML}`;
    wireAlertButtons(body);

    body.querySelectorAll(".hub-card[data-eid]").forEach((card) => {
      const eid = card.dataset.eid;
      const r = list.find((x) => x.event_id === eid);
      if (!r) return;

      const copyBtn = card.querySelector(".hub-copy");
      const msgBtn = card.querySelector(".hub-msg");
      const openBtn = card.querySelector(".hub-open");
      const doneBtn = card.querySelector(".hub-done");

      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          if (!r.sender_id) return showToast("No sender ID found.");
          showToast("Fetching reply...");
          apiGetReplyPayload(r.sender_id, async (err, payload) => {
            if (err || !payload || !payload.ok) return showToast("Could not get reply payload.");
            const txt =
              `Hi ${r.sender_name || "there"},\n\n` +
              `${payload.message_body}\n—`;
            const ok = await copyToClipboard(txt);
            showToast(ok ? `Reply copied ✅ (${payload.remaining_days ?? "?"} day(s) left)` : "Clipboard blocked — copy manually.");
          });
        });
      }

      if (msgBtn) {
        msgBtn.addEventListener("click", () => {
          showToast("Preparing message...");
          apiGetReplyPayload(r.sender_id, async (err, payload) => {
            if (err || !payload || !payload.ok) return showToast("Could not get reply payload.");
            const txt =
              `Hi ${r.sender_name || "there"},\n\n` +
              `${payload.message_body}\n—`;
            await copyToClipboard(txt);
            if (payload.compose_url) window.open(payload.compose_url, "_blank");
            showToast(`Message ready ✅ (${payload.remaining_days ?? "?"} day(s) left)`);
          });
        });
      }

      if (openBtn) {
        openBtn.addEventListener("click", () => {
          if (!r.sender_id) return showToast("No sender ID found.");
          window.open(`https://www.torn.com/profiles.php?XID=${r.sender_id}`, "_blank");
        });
      }

      if (doneBtn) {
        doneBtn.addEventListener("click", () => {
          apiPost("/api/renewals/done", { event_id: eid }, (err, resp) => {
            if (err || !resp || !resp.ok) return showToast("Could not mark done.");
            showToast("Marked done ✅ Moved to Records.");
            poll(true);
          });
        });
      }
    });
  }

  function renderCompanyClients(data) {
    const body = panel.querySelector("#hub-body");
    const clients = (data.clients || []);
    const summaryHTML = renderTopSummary(data);

    if (!clients.length) {
      body.innerHTML = `${summaryHTML}<div class="hub-muted">No clients yet.</div>`;
      return;
    }

    const activeCount = clients.filter((c) => !!c.active).length;
    const expiredCount = clients.length - activeCount;

    const toolbar = `
      <div class="hub-toolbar">
        <div class="hub-status active">✅ Active: ${activeCount}</div>
        <div class="hub-status expired">⌛ Expired: ${expiredCount}</div>
      </div>
    `;

    const listHTML = clients.map((c) => {
      const who = `${c.sender_name || "Unknown"}${c.sender_id ? " [" + c.sender_id + "]" : ""}`;
      const status = c.active
        ? `<div class="hub-status active">✅ Active — ${c.remaining_days} day(s) left</div>`
        : `<div class="hub-status expired">⌛ Expired</div>`;

      return `
        <div class="hub-card" data-clientid="${c.sender_id || ""}">
          <div class="hub-big">👤 ${who}</div>
          <div class="hub-muted">Valid until: ${fmtDate(c.renewed_until)}</div>
          <div class="hub-muted">Last updated: ${fmtDate(c.updated_at)}</div>
          ${status}
          <div class="hub-btns">
            <button class="hub-btn hub-client-copy">Copy reply</button>
            <button class="hub-btn good hub-client-msg">Message</button>
            <button class="hub-btn hub-client-open">Open profile</button>
          </div>
        </div>
      `;
    }).join("");

    body.innerHTML = `${summaryHTML}${toolbar}${listHTML}`;

    body.querySelectorAll("[data-clientid]").forEach((card) => {
      const senderId = card.getAttribute("data-clientid");
      const c = clients.find((x) => String(x.sender_id || "") === senderId);
      if (!c) return;

      const copyBtn = card.querySelector(".hub-client-copy");
      const msgBtn = card.querySelector(".hub-client-msg");
      const openBtn = card.querySelector(".hub-client-open");

      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          if (!senderId) return showToast("No sender ID found.");
          showToast("Fetching reply...");
          apiGetReplyPayload(senderId, async (err, payload) => {
            if (err || !payload || !payload.ok) return showToast("Could not get reply payload.");
            const txt =
              `Hi ${c.sender_name || "there"},\n\n` +
              `${payload.message_body}\n—`;
            const ok = await copyToClipboard(txt);
            showToast(ok ? `Reply copied ✅ (${payload.remaining_days ?? "?"} day(s) left)` : "Clipboard blocked — copy manually.");
          });
        });
      }

      if (msgBtn) {
        msgBtn.addEventListener("click", () => {
          if (!senderId) return showToast("No sender ID found.");
          showToast("Preparing message...");
          apiGetReplyPayload(senderId, async (err, payload) => {
            if (err || !payload || !payload.ok) return showToast("Could not get reply payload.");
            const txt =
              `Hi ${c.sender_name || "there"},\n\n` +
              `${payload.message_body}\n—`;
            await copyToClipboard(txt);
            if (payload.compose_url) window.open(payload.compose_url, "_blank");
            showToast(`Message ready ✅ (${payload.remaining_days ?? "?"} day(s) left)`);
          });
        });
      }

      if (openBtn) {
        openBtn.addEventListener("click", () => {
          if (!senderId) return showToast("No sender ID found.");
          window.open(`https://www.torn.com/profiles.php?XID=${senderId}`, "_blank");
        });
      }
    });
  }

  function renderCompanyRecords(data) {
    const body = panel.querySelector("#hub-body");
    const renewDays = data.renew_days || 45;
    const list = data.renewals_records || [];
    const summaryHTML = renderTopSummary(data);

    if (!list.length) {
      body.innerHTML = `${summaryHTML}<div class="hub-muted">No records yet.</div>`;
      return;
    }

    const listHTML = list.map((r) => {
      const who = `${r.sender_name || "Unknown"}${r.sender_id ? " [" + r.sender_id + "]" : ""}`;
      const doneLine = r.done ? `<div class="hub-muted">Marked done: ${fmtDate(r.done_at || "")}</div>` : "";
      const status = r.done
        ? `<div class="hub-status active">✅ Done</div>`
        : `<div class="hub-status">📁 Record only</div>`;

      return `
        <div class="hub-card" data-eid="${r.event_id}">
          <div class="hub-big">🏦 Renewal record — +${renewDays} days</div>
          <div class="hub-muted">Received: ${fmtDate(r.received_at)}</div>
          <div class="hub-muted">Client: ${who}</div>
          <div class="hub-muted">Deposit: ${r.qty} Xanax</div>
          <div class="hub-muted">Valid until: ${fmtDate(r.renewed_until)}</div>
          ${status}
          ${doneLine}
          <div class="hub-btns">
            <button class="hub-btn hub-copy">Copy reply</button>
            ${r.sender_id ? `<button class="hub-btn good hub-msg">Message</button>` : ""}
            <button class="hub-btn hub-open">Open profile</button>
            <button class="hub-btn bad hub-del">Delete</button>
          </div>
        </div>
      `;
    }).join("");

    body.innerHTML = `${summaryHTML}${listHTML}`;

    body.querySelectorAll(".hub-card[data-eid]").forEach((card) => {
      const eid = card.dataset.eid;
      const r = list.find((x) => x.event_id === eid);
      if (!r) return;

      const copyBtn = card.querySelector(".hub-copy");
      const msgBtn = card.querySelector(".hub-msg");
      const openBtn = card.querySelector(".hub-open");
      const delBtn = card.querySelector(".hub-del");

      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          if (!r.sender_id) return showToast("No sender ID found.");
          showToast("Fetching reply...");
          apiGetReplyPayload(r.sender_id, async (err, payload) => {
            if (err || !payload || !payload.ok) return showToast("Could not get reply payload.");
            const txt =
              `Hi ${r.sender_name || "there"},\n\n` +
              `${payload.message_body}\n—`;
            const ok = await copyToClipboard(txt);
            showToast(ok ? `Reply copied ✅ (${payload.remaining_days ?? "?"} day(s) left)` : "Clipboard blocked — copy manually.");
          });
        });
      }

      if (msgBtn) {
        msgBtn.addEventListener("click", () => {
          showToast("Preparing message...");
          apiGetReplyPayload(r.sender_id, async (err, payload) => {
            if (err || !payload || !payload.ok) return showToast("Could not get reply payload.");
            const txt =
              `Hi ${r.sender_name || "there"},\n\n` +
              `${payload.message_body}\n—`;
            await copyToClipboard(txt);
            if (payload.compose_url) window.open(payload.compose_url, "_blank");
            showToast(`Message ready ✅ (${payload.remaining_days ?? "?"} day(s) left)`);
          });
        });
      }

      if (openBtn) {
        openBtn.addEventListener("click", () => {
          if (!r.sender_id) return showToast("No sender ID found.");
          window.open(`https://www.torn.com/profiles.php?XID=${r.sender_id}`, "_blank");
        });
      }

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

  function renderCompany(data) {
    const sub = getSub();
    if (sub === "clients") renderCompanyClients(data);
    else if (sub === "records") renderCompanyRecords(data);
    else renderCompanyRenewals(data);
  }

  function renderWar() {
    const body = panel.querySelector("#hub-body");
    body.innerHTML = `
      <div class="hub-card">
        <div class="hub-big">⚔️ War Hub</div>
        <div class="hub-muted">Coming soon — this side is ready for your war tools and tabs.</div>
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
      if (!seen.has(r.event_id)) {
        newest = r;
        break;
      }
    }

    if (newest) {
      const who = `${newest.sender_name || "Unknown"}${newest.sender_id ? " [" + newest.sender_id + "]" : ""}`;
      showToast(`🏦 Renewal received: ${newest.qty || 50} Xanax from ${who}`);
      seen.add(newest.event_id);
      gmSetJSON(STORAGE_SEEN, Array.from(seen).slice(-500));
    }
  }

  function checkForAlertToasts(alertsOpen, clients) {
    const seen = new Set(gmGetJSON(STORAGE_SEEN_ALERTS, []));
    const nameById = new Map((clients || []).map((c) => [String(c.sender_id || ""), c.sender_name || "Unknown"]));
    let fired = 0;

    for (const a of (alertsOpen || [])) {
      const aid = String(a.alert_id);
      if (seen.has(aid)) continue;

      const sid = String(a.sender_id || "");
      const sname = nameById.get(sid) || "Unknown";
      const left = (a.remaining_days ?? "?");

      showToast(`⚠️ ${left} day(s) left — ${sname}${sid ? " [" + sid + "]" : ""}`);
      seen.add(aid);
      fired++;
      if (fired >= 3) break;
    }

    if (fired > 0) {
      gmSetJSON(STORAGE_SEEN_ALERTS, Array.from(seen).slice(-500));
    }
  }

  function poll(forceRender) {
    apiGet("/state", (err, data) => {
      if (err || !data) return;

      lastState = data;

      const openRenewals = data.renewals_open || [];
      const openAlerts = data.alerts_open || [];
      const clients = data.clients || [];

      updateBubble(openRenewals.length, openAlerts.length);
      checkForNewToast(openRenewals);
      checkForAlertToasts(openAlerts, clients);

      if (forceRender || panel.style.display !== "none") render();
    });
  }

  poll(true);
  setInterval(() => poll(false), POLL_MS);
})();
