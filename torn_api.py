import re
import requests
from typing import Any, Dict, Optional

API_BASE = "https://api.torn.com"


def fetch_new_events(api_key: str) -> Dict[str, Any]:
    # newevents returns only unseen events (generally until you visit events page)
    # If this ever changes, switch to: selections=events and track ids yourself.
    url = f"{API_BASE}/user/?selections=newevents&key={api_key}"
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    return r.json()


def extract_xanax_payment(event_text: str, qty_required: int = 100) -> Optional[Dict[str, Any]]:
    """
    Tries to match common Torn event phrases for receiving items.
    We look for:
      - quantity (100)
      - item name (Xanax)
      - sender (name + id if present)
    """
    text = event_text or ""
    if "Xanax" not in text and "xanax" not in text:
        return None
    if str(qty_required) not in text:
        return None

    # Quantity + item
    # Examples seen in the wild vary; we keep it forgiving:
    qty_item_ok = re.search(r"\b(\d+)\b.*\bXanax\b", text, re.IGNORECASE)
    if not qty_item_ok:
        return None
    qty = int(qty_item_ok.group(1))
    if qty != qty_required:
        return None

    sender_id = None
    sender_name = None

    # Try to find profile link like XID=123456
    m_id = re.search(r"XID=(\d+)", text)
    if m_id:
        sender_id = m_id.group(1)

    # Try to capture sender name before "sent you" / "gave you"
    # This is best-effort because the API event text can include HTML.
    m_name = re.search(r">([^<]{2,40})</a>\s+(sent|gave)\s+you", text, re.IGNORECASE)
    if m_name:
        sender_name = m_name.group(1).strip()
    else:
        # fallback: plain text patterns
        m_name2 = re.search(r"^(.{2,40})\s+(sent|gave)\s+you", text.strip(), re.IGNORECASE)
        if m_name2:
            sender_name = m_name2.group(1).strip()

    return {"qty": qty, "sender_id": sender_id, "sender_name": sender_name}
