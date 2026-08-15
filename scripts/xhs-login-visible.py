from pathlib import Path
import time

import qrcode
from camoufox.sync_api import Camoufox

from xhs_cli import auth


project_root = Path(__file__).resolve().parent.parent
qr_path = project_root / "data" / "research" / "xhs-login-qr.png"
qr_path.parent.mkdir(parents=True, exist_ok=True)


def save_qr_image(qr_text: str) -> None:
    image = qrcode.make(qr_text)
    image.save(qr_path)
    print(f"QR_IMAGE_PATH={qr_path}", flush=True)


def login_with_visible_browser() -> str:
    print("XHS_VISIBLE_LOGIN_START", flush=True)
    with Camoufox(headless=False) as browser:
        page = browser.new_page()
        with page.expect_response(
            lambda response: (
                auth.QR_CREATE_ENDPOINT in response.url
                and response.request.method == "POST"
            ),
            timeout=20_000,
        ) as qr_response_info:
            page.goto(auth.LOGIN_URL, wait_until="domcontentloaded", timeout=20_000)

        qr_payload = auth._browser_response_payload(qr_response_info.value)
        qr_url = str(qr_payload.get("url", "")).strip()
        if not qr_url:
            raise RuntimeError(f"QR login did not expose a QR URL: {qr_payload}")
        save_qr_image(qr_url)
        print("XHS_VISIBLE_LOGIN_WAITING", flush=True)

        with page.expect_response(
            lambda response: (
                auth.QR_STATUS_ENDPOINT in response.url
                and response.request.method == "GET"
            ),
            timeout=240_000,
        ) as completion_info:
            pass

        completion_response = completion_info.value
        auth._raise_for_browser_response(completion_response)
        completion_data = auth._browser_response_payload(completion_response)
        auth._wait_for_browser_login_settled(page)
        time.sleep(1)

        cookies = auth._normalize_browser_cookies(page.context.cookies())
        login_info = completion_data.get("login_info", {})
        if not isinstance(login_info, dict):
            login_info = {}
        session = login_info.get("session") or completion_data.get("session")
        secure_session = login_info.get("secure_session") or completion_data.get("secure_session")
        if isinstance(session, str) and session:
            cookies["web_session"] = session
        if isinstance(secure_session, str) and secure_session:
            cookies["web_session_sec"] = secure_session
        if not auth._has_required_cookies(cookies):
            raise RuntimeError(f"QR login cookies incomplete: {sorted(cookies)}")
        return auth._dict_to_cookie_str(cookies)


cookie = login_with_visible_browser()
auth.save_cookies(cookie)
print("XHS_LOGIN_SUCCESS", flush=True)
