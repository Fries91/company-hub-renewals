import os
import time
import threading
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify, send_from_directory
from dotenv import load_dotenv

from db import init_db, add_renewal_if_new, get_recent_renewals
from torn_api import fetch_new_events, extract_xanax_payment

load_dotenv()
app = Flask(__name__)

# ====== CONFIG (Render Environment Variables) ======
TORN_API_KEY = (os.getenv("TORN_API_KEY") or "").strip()  # your key (kept secret in Render)
POLL_SECONDS = int(os.getenv("POLL_SECONDS") or "30")
RENEW_DAYS = int(os.getenv("RENEW_DAYS") or "45")
PORT = int(os.getenv("PORT") or "10000")

# ===================================================

_booted = False
_last_poll_error = None
_last_poll_at = None


def poll_loop():
    global _last_poll_error, _last_poll_at
    while True:
        try:
            if not TORN_API_KEY:
                _last_poll_error = "Missing TORN_API_KEY in environment."
                time.sleep(10)
                continue

            data = fetch_new_events(TORN_API_KEY)
            _last_poll_at = datetime.now(timezone.utc).isoformat()
            _last_poll_error = None

            events = (data or {}).get("events") or {}
            # events is typically a dict keyed by event id strings
            for eid, ev in events.items():
                ev_text = (ev or {}).get("event") or ""
                ev_ts = (ev or {}).get("timestamp")

                match = extract_xanax_payment(ev_text, qty_required=100)
                if not match:
                    continue

                sender_id = match.get("sender_id")
                sender_name = match.get("sender_name") or "Unknown"
                qty = match.get("qty") or 100

                received_at = datetime.fromtimestamp(int(ev_ts), tz=timezone.utc) if ev_ts else datetime.now(timezone.utc)
                renewed_until = received_at + timedelta(days=RENEW_DAYS)

                add_renewal_if_new(
                    event_id=str(eid),
                    sender_id=str(sender_id) if sender_id else None,
                    sender_name=str(sender_name),
                    qty=int(qty),
                    received_at_iso=received_at.isoformat(),
                    renewed_until_iso=renewed_until.isoformat(),
                    raw_text=ev_text[:1000],
                )

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
    t = threading.Thread(target=poll_loop, daemon=True)
    t.start()


@app.get("/health")
def health():
    return jsonify(
        ok=True,
        last_poll_at=_last_poll_at,
        last_error=_last_poll_error,
        poll_seconds=POLL_SECONDS,
        renew_days=RENEW_DAYS,
    )


@app.get("/state")
def state():
    renewals = get_recent_renewals(limit=30)
    return jsonify(
        renew_days=RENEW_DAYS,
        last_poll_at=_last_poll_at,
        last_error=_last_poll_error,
        renewals=renewals,
        server_time=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/static/<path:filename>")
def static_files(filename):
    return send_from_directory("static", filename)


@app.get("/")
def index():
    # tiny page so you can confirm it’s running
    return (
        "<h3>Company Hub Renewals is running ✅</h3>"
        "<p>Use <code>/health</code> and <code>/state</code>.</p>"
        "<p>Your userscript is at <code>/static/hub.user.js</code>.</p>"
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
