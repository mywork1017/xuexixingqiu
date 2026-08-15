import json
import os
import sys
import time

from xhs_cli import auth
from xhs_cli.client import XhsClient


def get_note_detail(client, note_id, xsec_token):
    wait_seconds = float(os.environ.get("XHS_NOTE_WAIT_SECONDS", "15"))
    if wait_seconds >= 15:
        return client.get_note_detail(note_id, xsec_token)

    url = f"https://www.xiaohongshu.com/explore/{note_id}"
    if xsec_token:
        url += f"?xsec_token={xsec_token}&xsec_source=pc_feed"
    client._goto(
        url,
        timeout=20000,
        wait_min=1.5,
        wait_max=3,
        context=f"loading note {note_id}",
    )
    client._wait_for_data(
        """() => {
            const s = window.__INITIAL_STATE__;
            return s && s.note && s.note.noteDetailMap
                && Object.keys(s.note.noteDetailMap).length > 0;
        }""",
        timeout=wait_seconds,
        desc="note.noteDetailMap",
        raise_on_timeout=True,
    )
    for _attempt in range(3):
        result = client._page.evaluate(
            """() => {
                const map = window.__INITIAL_STATE__?.note?.noteDetailMap;
                return map ? JSON.parse(JSON.stringify(map)) : null;
            }"""
        )
        if result:
            return result.get(note_id) or next(iter(result.values()))
        time.sleep(0.5)
    raise RuntimeError(f"Failed to extract note detail for {note_id}")


cookie_string = auth.get_saved_cookie_string()
if not cookie_string:
    raise RuntimeError("No saved xhs-cli login session")

cookie_dict = auth.cookie_str_to_dict(cookie_string)
with XhsClient(cookie_dict) as client:
    for line in sys.stdin:
        request = json.loads(line)
        request_id = request.get("id")
        try:
            operation = request.get("operation")
            if operation == "search":
                data = client.search_notes(str(request.get("query", "")))
            elif operation == "read":
                detail = get_note_detail(
                    client,
                    str(request.get("noteId", "")),
                    str(request.get("xsecToken", "")),
                )
                data = {"note": detail.get("note", detail)}
            else:
                raise ValueError(f"Unsupported operation: {operation}")
            response = {"id": request_id, "ok": True, "data": data}
        except Exception as error:
            response = {
                "id": request_id,
                "ok": False,
                "error": f"{type(error).__name__}: {error}",
            }
        print(json.dumps(response, ensure_ascii=False), flush=True)
