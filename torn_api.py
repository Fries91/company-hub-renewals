# torn_api.py ✅ COMPLETE (your version fixed): detect ANY Xanax receipt (no "sent you" gate)
import re
import requests
from typing import Dict, Any, Optional

API_BASE = "https://api.torn.com"


def fetch_events(api_key: str, limit: int = 100) -> Dict[str, Any]:
    params = {"selections": "events", "key": api_key}
    url = f"{API_BASE}/user/"
    r = requests.get(url, params=params, timeout=25)
    r.raise_for_status()
    return r.json()


def extract_xanax_payment(event_text: str, qty_required: int = 100) -> Optional[Dict[str, Any]]:
    if not event_text:
        return None

    txt = event_text.replace("&nbsp;", " ")

    # qty (supports "100 Xanax" or "100x Xanax" or "100 x Xanax")
    m_qty = re.search(r"(\d+)\s*(?:x\s*)?\s*Xanax\b", txt, re.IGNORECASE)
    if not m_qty:
        return None

    qty = int(m_qty.group(1))
    if qty < int(qty_required):
        return None

    # sender_id via XID=12345 inside link
    m_id = re.search(r"XID=(\d+)", txt)
    sender_id = m_id.group(1) if m_id else None

    # sender_name:
    m_name = re.search(r">([^<]{1,60})<", txt)
    sender_name = (m_name.group(1).strip() if m_name else None)

    if not sender_name and sender_id:
        m_name2 = re.search(
            r"([A-Za-z0-9_\-\.\'\s]{1,60})\s*\[\s*" + re.escape(sender_id) + r"\s*\]",
            txt
        )
        sender_name = m_name2.group(1).strip() if m_name2 else None

    if not sender_name:
        sender_name = "Unknown"

    return {"sender_id": sender_id, "sender_name": sender_name, "qty": qty}
