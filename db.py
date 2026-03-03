import os
import sqlite3
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("DB_PATH", "companyhub.db")


def _con():
    return sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)


def init_db():
    con = _con()
    cur = con.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS renewals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT UNIQUE NOT NULL,
            sender_id TEXT,
            sender_name TEXT NOT NULL,
            qty INTEGER NOT NULL,
            received_at_iso TEXT NOT NULL,
            renewed_until_iso TEXT NOT NULL,
            raw_text TEXT,
            created_at_iso TEXT NOT NULL
        )
        """
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
        (event_id, sender_id, sender_name, qty, received_at_iso, renewed_until_iso, raw_text, created_at_iso)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """,
        (event_id, sender_id, sender_name, qty, received_at_iso, renewed_until_iso, raw_text),
    )

    con.commit()
    con.close()


def get_recent_renewals(limit: int = 30) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()

    cur.execute(
        """
        SELECT event_id, sender_id, sender_name, qty, received_at_iso, renewed_until_iso
        FROM renewals
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    )

    rows = cur.fetchall()
    con.close()

    out = []
    for r in rows:
        out.append(
            {
                "event_id": r[0],
                "sender_id": r[1],
                "sender_name": r[2],
                "qty": r[3],
                "received_at": r[4],
                "renewed_until": r[5],
            }
        )
    return out
