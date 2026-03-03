# db.py ✅ COMPLETE: renewals + subscriptions + alerts (5-days-left warning)
import os
import sqlite3
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone, timedelta

DB_PATH = os.getenv("DB_PATH", "companyhub.db")


def _con():
    return sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)


def init_db():
    con = _con()
    cur = con.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS settings (
      k TEXT PRIMARY KEY,
      v TEXT
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS renewals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      sender_id TEXT,
      sender_name TEXT NOT NULL,
      qty INTEGER NOT NULL,
      received_at_iso TEXT NOT NULL,
      renewed_until_iso TEXT NOT NULL,
      raw_text TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      done_at_iso TEXT
    )
    """)

    # per-sender countdown
    cur.execute("""
    CREATE TABLE IF NOT EXISTS subscriptions (
      sender_id TEXT PRIMARY KEY,
      renewed_until_iso TEXT NOT NULL,
      updated_at_iso TEXT NOT NULL
    )
    """)

    # ✅ alerts (e.g. 5_days_left)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      renewed_until_iso TEXT NOT NULL,
      remaining_days INTEGER NOT NULL,
      created_at_iso TEXT NOT NULL,
      ack INTEGER NOT NULL DEFAULT 0,
      ack_at_iso TEXT
    )
    """)

    # unique per sender+kind+renewed_until so you only get 1 warning per cycle
    cur.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_unique
    ON alerts(sender_id, kind, renewed_until_iso)
    """)

    # safe alters if DB existed earlier
    for stmt in [
        "ALTER TABLE renewals ADD COLUMN done INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE renewals ADD COLUMN done_at_iso TEXT",
    ]:
        try:
            cur.execute(stmt)
        except Exception:
            pass

    con.commit()
    con.close()


def get_setting(key: str, default: str = "") -> str:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT v FROM settings WHERE k=?", (key,))
    row = cur.fetchone()
    con.close()
    return row[0] if row and row[0] is not None else default


def set_setting(key: str, value: str) -> None:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (key, value),
    )
    con.commit()
    con.close()


def add_renewal_if_new(
    event_id: str,
    sender_id: Optional[str],
    sender_name: str,
    qty: int,
    received_at_iso: str,
    renewed_until_iso: str,
    raw_text: str,
):
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT OR IGNORE INTO renewals
        (event_id, sender_id, sender_name, qty, received_at_iso, renewed_until_iso, raw_text, done, done_at_iso)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
        """,
        (event_id, sender_id, sender_name, qty, received_at_iso, renewed_until_iso, raw_text),
    )
    con.commit()
    con.close()


def mark_done(event_id: str) -> bool:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE renewals SET done=1, done_at_iso=datetime('now') WHERE event_id=?",
        (event_id,),
    )
    changed = cur.rowcount > 0
    con.commit()
    con.close()
    return changed


def delete_record(event_id: str) -> bool:
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM renewals WHERE event_id=?", (event_id,))
    changed = cur.rowcount > 0
    con.commit()
    con.close()
    return changed


def _rows_to_dicts(rows) -> List[Dict[str, Any]]:
    out = []
    for r in rows:
        out.append({
            "event_id": r[0],
            "sender_id": r[1],
            "sender_name": r[2],
            "qty": r[3],
            "received_at": r[4],
            "renewed_until": r[5],
            "done": bool(r[6]),
            "done_at": r[7],
        })
    return out


def get_open_renewals(limit: int = 50) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        SELECT event_id, sender_id, sender_name, qty, received_at_iso, renewed_until_iso, done, done_at_iso
        FROM renewals
        WHERE done=0
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    )
    rows = cur.fetchall()
    con.close()
    return _rows_to_dicts(rows)


def get_all_renewals(limit: int = 300) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        SELECT event_id, sender_id, sender_name, qty, received_at_iso, renewed_until_iso, done, done_at_iso
        FROM renewals
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    )
    rows = cur.fetchall()
    con.close()
    return _rows_to_dicts(rows)


# =======================
# subscriptions
# =======================

def get_subscription(sender_id: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT sender_id, renewed_until_iso, updated_at_iso FROM subscriptions WHERE sender_id=?",
        (sender_id,),
    )
    row = cur.fetchone()
    con.close()
    if not row:
        return None
    return {"sender_id": row[0], "renewed_until": row[1], "updated_at": row[2]}


def list_subscriptions(limit: int = 2000) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT sender_id, renewed_until_iso, updated_at_iso FROM subscriptions ORDER BY updated_at_iso DESC LIMIT ?",
        (limit,),
    )
    rows = cur.fetchall()
    con.close()
    out = []
    for r in rows:
        out.append({"sender_id": r[0], "renewed_until": r[1], "updated_at": r[2]})
    return out


def extend_subscription(sender_id: str, received_at_dt: datetime, days: int = 60) -> datetime:
    """
    Start or extend:
      base = max(existing_until, received_at_dt)
      renewed_until = base + days
    """
    if received_at_dt.tzinfo is None:
        received_at_dt = received_at_dt.replace(tzinfo=timezone.utc)

    existing = get_subscription(sender_id)
    base_dt = received_at_dt

    if existing and existing.get("renewed_until"):
        try:
            existing_until = datetime.fromisoformat(existing["renewed_until"].replace("Z", "+00:00"))
            if existing_until.tzinfo is None:
                existing_until = existing_until.replace(tzinfo=timezone.utc)
            base_dt = max(existing_until, received_at_dt)
        except Exception:
            base_dt = received_at_dt

    renewed_until = base_dt + timedelta(days=int(days))
    now_iso = datetime.now(timezone.utc).isoformat()

    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO subscriptions(sender_id, renewed_until_iso, updated_at_iso)
        VALUES(?, ?, ?)
        ON CONFLICT(sender_id) DO UPDATE SET
          renewed_until_iso=excluded.renewed_until_iso,
          updated_at_iso=excluded.updated_at_iso
        """,
        (sender_id, renewed_until.isoformat(), now_iso),
    )
    con.commit()
    con.close()
    return renewed_until


# =======================
# alerts (5 days left)
# =======================

def add_alert_if_new(sender_id: str, kind: str, renewed_until_iso: str, remaining_days: int) -> None:
    con = _con()
    cur = con.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        INSERT OR IGNORE INTO alerts
        (sender_id, kind, renewed_until_iso, remaining_days, created_at_iso, ack, ack_at_iso)
        VALUES (?, ?, ?, ?, ?, 0, NULL)
        """,
        (sender_id, kind, renewed_until_iso, int(remaining_days), now_iso),
    )
    con.commit()
    con.close()


def get_open_alerts(limit: int = 50) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        SELECT id, sender_id, kind, renewed_until_iso, remaining_days, created_at_iso
        FROM alerts
        WHERE ack=0
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    )
    rows = cur.fetchall()
    con.close()
    out = []
    for r in rows:
        out.append({
            "alert_id": str(r[0]),
            "sender_id": r[1],
            "kind": r[2],
            "renewed_until": r[3],
            "remaining_days": int(r[4]),
            "created_at": r[5],
        })
    return out


def ack_alert(alert_id: str) -> bool:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE alerts SET ack=1, ack_at_iso=datetime('now') WHERE id=?",
        (alert_id,),
    )
    changed = cur.rowcount > 0
    con.commit()
    con.close()
    return changed
