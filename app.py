# app.py ✅ COMPLETE: 60-day countdown + reply payload (X days left) + 5-day warning alerts
import os
import time
import threading
import math
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify, request, send_from_directory, Response
from dotenv import load_dotenv

from db import (
    init_db,
    add_renewal_if_new,
    get_open_renewals,
    get_all_renewals,
    mark_done,
    delete_record,
    get_setting,
    set_setting,
    # subscriptions
    get_subscription,
    extend_subscription,
    list_subscriptions,
    # alerts
    add_alert_if_new,
    get_open_alerts,
    ack_alert,
)

from torn_api import fetch_events, extract_xanax_payment

load_dotenv()
app = Flask(__name__)

TORN_API_KEY = (os.getenv("TORN_API_KEY") or "").strip()
POLL_SECONDS = int(os.getenv("POLL_SECONDS") or "30")

# ✅ 60 day countdown
RENEW_DAYS = int(os.getenv("RENEW_DAYS") or "60")

# ✅ warning threshold
WARN_DAYS = int(os.getenv("WARN_DAYS") or "5")

PORT = int(os.getenv("PORT") or "10000")

_booted = False
_last_poll_error = None
_last_poll_at = None

SET_LAST_TS = "last_seen_event_ts"


def _ceil_days_left(renewed_until_iso: str) -> int:
    if not renewed_until_iso:
        return 0
    try:
        dt = datetime.fromisoformat(renewed_until_iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        secs = max(0, int((dt - now).total_seconds()))
        return int(math.ceil(secs / 86400)) if secs > 0 else 0
    except Exception:
        return 0


def check_warning_alerts():
    """
    Create a single 5-days-left alert per sender per renewed_until.
    """
    subs = list_subscriptions(limit=2000)
    for s in subs:
        sender_id = s.get("sender_id")
        renewed_until = s.get("renewed_until") or ""
        if not sender_id or not renewed_until:
            continue

        days_left = _ceil_days_left(renewed_until)
        if 0 < days_left <= WARN_DAYS:
            # unique per sender+renewed_until+kind
            add_alert_if_new(
                sender_id=str(sender_id),
                kind=f"{WARN_DAYS}_days_left",
                renewed_until_iso=renewed_until,
                remaining_days=days_left,
            )


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

                # advance checkpoint even if not a payment
                max_ts = max(max_ts, ts)

                if not match:
                    continue

                sender_id = match.get("sender_id")
                sender_name = match.get("sender_name") or "Unknown"
                qty = match.get("qty") or 100

                received_at = datetime.fromtimestamp(ts, tz=timezone.utc)

                # ✅ START or EXTEND sender countdown by 60 days
                if sender_id:
                    renewed_until = extend_subscription(str(sender_id), received_at, days=RENEW_DAYS)
                else:
                    renewed_until = received_at + timedelta(days=RENEW_DAYS)

                # log the event (keeps open/records UI)
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

            # ✅ after polling, generate 5-day warnings
            check_warning_alerts()

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
    resp = jsonify(payload)
    resp.status_code = code
    resp.headers["Cache-Control"] = "no-store"
    return resp


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
        "warn_days": WARN_DAYS,
        "last_seen_event_ts": get_setting(SET_LAST_TS, "0"),
        "server_time": datetime.now(timezone.utc).isoformat(),
    })


@app.route("/state", methods=["GET"])
@app.route("/state/", methods=["GET"])
def state():
    return _json_ok({
        "renew_days": RENEW_DAYS,
        "warn_days": WARN_DAYS,
        "last_poll_at": _last_poll_at,
        "last_error": _last_poll_error,
        "renewals_open": get_open_renewals(limit=50),
        "renewals_records": get_all_renewals(limit=300),
        # ✅ open warnings
        "alerts_open": get_open_alerts(limit=50),
        "server_time": datetime.now(timezone.utc).isoformat(),
    })


# ✅ status endpoint (remaining days/seconds)
@app.route("/api/subscription/status", methods=["GET"])
def api_sub_status():
    sender_id = str(request.args.get("sender_id") or "").strip()
    if not sender_id:
        return _json_ok({"ok": False, "error": "Missing sender_id"}, 400)

    sub = get_subscription(sender_id)
    if not sub:
        return _json_ok({"ok": True, "active": False, "sender_id": sender_id})

    renewed_until_iso = sub["renewed_until"]
    now = datetime.now(timezone.utc)

    remaining_days = _ceil_days_left(renewed_until_iso)
    active = remaining_days > 0

    return _json_ok({
        "ok": True,
        "active": active,
        "sender_id": sender_id,
        "renewed_until": renewed_until_iso,
        "remaining_days": remaining_days,
        "server_time": now.isoformat(),
    })


# ✅ reply payload: "Renewal accepted — currently have X days left" + compose URL for that XID
@app.route("/api/reply_payload", methods=["GET"])
def api_reply_payload():
    sender_id = str(request.args.get("sender_id") or "").strip()
    if not sender_id:
        return _json_ok({"ok": False, "error": "Missing sender_id"}, 400)

    sub = get_subscription(sender_id)
    renewed_until_iso = (sub or {}).get("renewed_until") or ""
    remaining_days = _ceil_days_left(renewed_until_iso)
    active = remaining_days > 0

    body = (
        f"Renewal accepted ✅\n"
        f"You currently have {remaining_days} day(s) left.\n"
        f"Renewed until (UTC): {renewed_until_iso or 'N/A'}\n"
        f"\nThank you for using my service.\n"
        f"Other: come check out my profile signature for updates of hubs.\n"
    )

    compose_url = f"https://www.torn.com/messages.php#/p=compose&XID={sender_id}"

    return _json_ok({
        "ok": True,
        "sender_id": sender_id,
        "active": active,
        "renewed_until": renewed_until_iso,
        "remaining_days": remaining_days,
        "message_body": body,
        "compose_url": compose_url,
        "server_time": datetime.now(timezone.utc).isoformat(),
    })


# ✅ warning payload: "5 days left of hub access"
@app.route("/api/warn_payload", methods=["GET"])
def api_warn_payload():
    sender_id = str(request.args.get("sender_id") or "").strip()
    if not sender_id:
        return _json_ok({"ok": False, "error": "Missing sender_id"}, 400)

    sub = get_subscription(sender_id)
    renewed_until_iso = (sub or {}).get("renewed_until") or ""
    remaining_days = _ceil_days_left(renewed_until_iso)

    body = (
        f"⚠️ {WARN_DAYS} days left of hub access.\n"
        f"You currently have {remaining_days} day(s) remaining.\n"
        f"Renewed until (UTC): {renewed_until_iso or 'N/A'}\n"
    )
    compose_url = f"https://www.torn.com/messages.php#/p=compose&XID={sender_id}"

    return _json_ok({
        "ok": True,
        "sender_id": sender_id,
        "renewed_until": renewed_until_iso,
        "remaining_days": remaining_days,
        "message_body": body,
        "compose_url": compose_url,
        "server_time": datetime.now(timezone.utc).isoformat(),
    })


# ✅ ack an alert so it stops warning you
@app.route("/api/alerts/ack", methods=["POST"])
def api_alert_ack():
    data = request.get_json(force=True, silent=True) or {}
    alert_id = str(data.get("alert_id") or "").strip()
    if not alert_id:
        return _json_ok({"ok": False, "error": "Missing alert_id"}, 400)
    ok = ack_alert(alert_id)
    return _json_ok({"ok": ok})


@app.route("/api/renewals/done", methods=["POST"])
def api_done():
    data = request.get_json(force=True, silent=True) or {}
    event_id = str(data.get("event_id") or "").strip()
    if not event_id:
        return _json_ok({"ok": False, "error": "Missing event_id"}, 400)
    ok = mark_done(event_id)
    return _json_ok({"ok": ok})


@app.route("/api/renewals/delete", methods=["POST"])
def api_delete():
    data = request.get_json(force=True, silent=True) or {}
    event_id = str(data.get("event_id") or "").strip()
    if not event_id:
        return _json_ok({"ok": False, "error": "Missing event_id"}, 400)
    ok = delete_record(event_id)
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
