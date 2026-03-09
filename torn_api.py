# torn_api.py ✅ COMPLETE: detect ANY Xanax receipt with minimum qty threshold
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


def _clean_html_text(txt: str) -> str:
    txt = txt or ""
    txt = txt.replace("&nbsp;", " ")
    txt = txt.replace("&#039;", "'")
    txt = txt.replace("&amp;", "&")
    txt = txt.replace("&quot;", '"')
    return txt


def extract_xanax_payment(event_text: str, qty_required: int = 50) -> Optional[Dict[str, Any]]:
    if not event_text:
        return None

    txt = _clean_html_text(event_text)

    if not re.search(r"\bXanax\b", txt, re.IGNORECASE):
        return None

    m_qty = re.search(r"(\d+)\s*(?:x\s*)?\s*Xanax\b", txt, re.IGNORECASE)
    if not m_qty:
        m_qty = re.search(r"\bXanax\b\s*(?:x\s*)?(\d+)", txt, re.IGNORECASE)
    if not m_qty:
        return None

    qty = int(m_qty.group(1))
    if qty < int(qty_required):
        return None

    m_id = re.search(r"XID=(\d+)", txt, re.IGNORECASE)
    sender_id = m_id.group(1) if m_id else None

    sender_name = None

    m_name = re.search(
        r'<a[^>]+XID=' + re.escape(sender_id) + r'[^>]*>([^<]{1,60})</a>',
        txt,
        re.IGNORECASE
    ) if sender_id else None
    if m_name:
        sender_name = m_name.group(1).strip()

    if not sender_name:
        m_name2 = re.search(r">([^<]{1,60})<", txt)
        if m_name2:
            sender_name = m_name2.group(1).strip()

    if not sender_name and sender_id:
        m_name3 = re.search(
            r"([A-Za-z0-9_\-\.\'\s]{1,60})\s*\[\s*" + re.escape(sender_id) + r"\s*\]",
            txt
        )
        if m_name3:
            sender_name = m_name3.group(1).strip()

    if not sender_name:
        sender_name = "Unknown"

    return {
        "sender_id": sender_id,
        "sender_name": sender_name,
        "qty": qty,
    }
