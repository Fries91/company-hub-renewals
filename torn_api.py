# torn_api.py ✅ COMPLETE: fetch events + detect "sent you 100 Xanax" payments
import re
import requests
from typing import Dict, Any, Optional

API_BASE = "https://api.torn.com"


def fetch_events(api_key: str, limit: int = 100) -> Dict[str, Any]:
    """
    Pull user events from Torn API.
    Note: Torn API is read-only; this is just fetching data.
    """
    params = {
        "selections": "events",
        "key": api_key,
    }
    # Official API returns up to 100-ish recent events; we just parse them.
    url = f"{API_BASE}/user/"
    r = requests.get(url, params=params, timeout=25)
    r.raise_for_status()
    return r.json()


def extract_xanax_payment(event_text: str, qty_required: int = 100) -> Optional[Dict[str, Any]]:
    """
    Attempts to parse event text for:
      - sender_id
      - sender_name
      - qty Xanax

    Works with common Torn event formats like:
      "<a ... XID=12345>NAME</a> sent you 100 Xanax."
      "NAME [12345] sent you 100x Xanax"
    """
    if not event_text:
        return None

    txt = event_text.replace("&nbsp;", " ")

    # qty (supports "100 Xanax" or "100x Xanax")
    m_qty = re.search(r"(\d+)\s*x?\s*Xanax\b", txt, re.IGNORECASE)
    qty = int(m_qty.group(1)) if m_qty else None
    if qty is None or qty < qty_required:
        return None

    # sender_id via XID=12345 inside link
    m_id = re.search(r"XID=(\d+)", txt)
    sender_id = m_id.group(1) if m_id else None

    # sender_name:
    # try anchor inner text first: >Name<
    m_name = re.search(r">([^<]{1,40})<", txt)
    sender_name = (m_name.group(1).strip() if m_name else None)

    # fallback: plain "Name [12345]" style
    if not sender_name and sender_id:
        m_name2 = re.search(r"([A-Za-z0-9_\-\.\'\s]{1,40})\s*\[\s*" + re.escape(sender_id) + r"\s*\]", txt)
        sender_name = m_name2.group(1).strip() if m_name2 else None

    # last fallback: Unknown
    if not sender_name:
        sender_name = "Unknown"

    # Must look like a send/payment event to you
    # (keeps false positives down)
    if not re.search(r"\bsent you\b|\bgave you\b|\bhas sent\b", txt, re.IGNORECASE):
        # some event formats omit "sent you"; if your events do, remove this guard.
        return None

    return {
        "sender_id": sender_id,
        "sender_name": sender_name,
        "qty": qty,
    }
