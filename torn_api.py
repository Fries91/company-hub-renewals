import re
import html
import requests
from typing import Any, Dict, Optional, Tuple

API_BASE = "https://api.torn.com"


def fetch_events(api_key: str, limit: int = 100) -> Dict[str, Any]:
    # Pull recent events every time (reliable, even if you viewed events)
    url = f"{API_BASE}/user/?selections=events&limit={limit}&key={api_key}"
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    return r.json()


def _strip_html(s: str) -> str:
    s = s or ""
    s = html.unescape(s)
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def extract_xanax_payment(event_html: str, qty_required: int = 100) -> Optional[Dict[str, Any]]:
    """
    Detect receiving EXACTLY qty_required Xanax from another player.
    Handles formats like:
      - "X sent you 100 Xanax"
      - "X sent you 100x Xanax"
      - HTML anchor tags with XID
    """
    raw = event_html or ""
    text = _strip_html(raw)

    # Must mention Xanax
    if re.search(r"\bXanax\b", text, re.I) is None:
        return None

    # Quantity patterns: "100 Xanax" or "100x Xanax" or "100 x Xanax"
    m_qty = re.search(r"\b(\d+)\s*(?:x|×)?\s*Xanax\b", text, re.I)
    if not m_qty:
        # fallback: sometimes "Xanax (100)" style
        m_qty = re.search(r"\bXanax\b.*\b(\d+)\b", text, re.I)

    if not m_qty:
        return None

    try:
        qty = int(m_qty.group(1))
    except Exception:
        return None

    if qty != qty_required:
        return None

    # Sender ID from href if present
    sender_id = None
    m_id = re.search(r"profiles\.php\?XID=(\d+)", raw, re.I)
    if m_id:
        sender_id = m_id.group(1)
    else:
        m_id2 = re.search(r"\bXID=(\d+)\b", raw, re.I)
        if m_id2:
            sender_id = m_id2.group(1)

    # Sender name best-effort: try "NAME sent you"
    sender_name = None
    m_name = re.search(r"^(.{2,40}?)\s+(sent|gave)\s+you\b", text, re.I)
    if m_name:
        sender_name = m_name.group(1).strip()

    return {"qty": qty, "sender_id": sender_id, "sender_name": sender_name}
