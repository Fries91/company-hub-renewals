import os
import sqlite3
from typing import Any, Dict, List, Optional

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
