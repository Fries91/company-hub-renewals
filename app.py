import os
import time
import threading
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify, request, send_from_directory, Response
from dotenv import load_dotenv

from db import (
    init_db, add_renewal_if_new, get_open_renewals, get_all_renewals,
    mark_done, get_setting, set_setting
)
from torn_api import fetch_events, extract_xanax_payment

load_dotenv()
app = Flask(__name__)

TORN_API_KEY = (os.getenv("TORN_API_KEY") or "").strip()
POLL_SECONDS = int(os.getenv("POLL_SECONDS") or "30")
RENEW_DAYS = int(os.getenv("RENEW_DAYS") or "45")
PORT = int(os.getenv("PORT") or "10000")

_booted = False
_last_poll_error = None
_last_poll_at = None

SET_LAST_TS = "last_seen_event_ts"


def poll_loop():
    global _last_poll_error, _last_poll_at

    while True:
        try:
            if not TORN_API_KEY:
                _last_poll_error = "Missing TORN_API_KEY in environment."
                time.sleep(10)
                continue

            data = fetch_events(TORN_API_KEY, limit=100)
            _last_poll_at = datetime.now(timezone.utc).isoformat()
            _last_poll_error = None

            events = (data or {}).get("events") or {}

            last_ts = int(get_setting(SET_LAST_TS, "0") or "0")

            items = []
            for eid, ev in events.items():
                try:
                    ts = int((ev or {}).get("timestamp") or 0)
                except Exception:
                    ts = 0
                items.append((ts, str(eid), ev or {}))

            items.sort(key=lambda x: x[0])  # oldest -> newest
            max_ts = last_ts

            for ts, eid, ev in items:
                if ts <= last_ts:
                    continue

                ev_text = (ev.get("event") or "")
                match = extract_xanax_payment(ev_text, qty_required=100)

                # advance checkpoint even if it's not a payment,
                # so we don't re-scan the same history forever
                max_ts = max(max_ts, ts)

                if not match:
                    continue

                sender_id = match.get("sender_id")
                sender_name = match.get("sender_name") or "Unknown"
                qty = match.get("qty") or 100

                received_at = datetime.fromtimestamp(ts, tz=timezone.utc)
                renewed_until = received_at + timedelta(days=RENEW_DAYS)

                add_renewal_if_new(
                    event_id=eid,
                    sender_id=str(sender_id) if sender_id else None,
                    sender_name=str(sender_name),
                    qty=int(qty),
                    received_at_iso=received_at.isoformat(),
                    renewed_until_iso=renewed_until.isoformat(),
                    raw_text=ev_text[:1000],
                )

            if max_ts > last_ts:
                set_setting(SET_LAST_TS, str(max_ts))

        except Exception as e:
            _last_poll_error = f"{type(e).__name__}: {e}"

        time.sleep(POLL_SECONDS)


@app.before_request
def _start_once():
    global _booted
    if _booted:
        return
    _booted = True
    init_db()
    threading.Thread(target=poll_loop, daemon=True).start()


def _json_ok(payload, code=200):
    # consistent JSON response, avoids odd caching issues
    resp = jsonify(payload)
    resp.status_code = code
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ✅ HEALTH: supports /health, /health/, /healthz, /healthz/
@app.route("/health", methods=["GET"])
@app.route("/health/", methods=["GET"])
@app.route("/healthz", methods=["GET"])
@app.route("/healthz/", methods=["GET"])
def health():
    return _json_ok({
        "ok": True,
        "last_poll_at": _last_poll_at,
        "last_error": _last_poll_error,
        "poll_seconds": POLL_SECONDS,
        "renew_days": RENEW_DAYS,
        "last_seen_event_ts": get_setting(SET_LAST_TS, "0"),
        "server_time": datetime.now(timezone.utc).isoformat(),
    })


@app.route("/state", methods=["GET"])
@app.route("/state/", methods=["GET"])
def state():
    return _json_ok({
        "renew_days": RENEW_DAYS,
        "last_poll_at": _last_poll_at,
        "last_error": _last_poll_error,
        "renewals_open": get_open_renewals(limit=50),
        "renewals_records": get_all_renewals(limit=300),
        "server_time": datetime.now(timezone.utc).isoformat(),
    })


@app.route("/api/renewals/done", methods=["POST"])
def api_done():
    data = request.get_json(force=True, silent=True) or {}
    event_id = str(data.get("event_id") or "").strip()
    if not event_id:
        return _json_ok({"ok": False, "error": "Missing event_id"}, 400)
    ok = mark_done(event_id)
    return _json_ok({"ok": ok})


@app.route("/static/<path:filename>", methods=["GET"])
def static_files(filename):
    return send_from_directory("static", filename)


@app.route("/", methods=["GET"])
def index():
    return Response(
        "<h3>Company Hub Renewals is running ✅</h3>"
        "<p>Try <code>/health</code> and <code>/state</code>.</p>"
        "<p>Userscript: <code>/static/hub.user.js</code></p>",
        mimetype="text/html",
        headers={"Cache-Control": "no-store"},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
