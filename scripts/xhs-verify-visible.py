import time
from pathlib import Path

from camoufox.sync_api import Camoufox

from xhs_cli import auth


cookie_string = auth.get_saved_cookie_string()
if not cookie_string:
    raise RuntimeError("No saved xhs-cli login session")

cookie_dict = auth.cookie_str_to_dict(cookie_string)
project_root = Path(__file__).resolve().parent.parent
verification_path = project_root / "data" / "research" / "xhs-verification.png"
with Camoufox(
    headless=False,
    os="macos",
    locale="zh-CN",
    fonts=["PingFang SC", "Hiragino Sans GB", "Songti SC"],
) as browser:
    page = browser.new_page()
    page.context.add_cookies([
        {"name": key, "value": value, "domain": ".xiaohongshu.com", "path": "/"}
        for key, value in cookie_dict.items()
    ])
    page.goto(
        "https://www.xiaohongshu.com/search_result?keyword=%E4%B8%8A%E6%B5%B7%E5%9B%BE%E4%B9%A6%E9%A6%86&source=web_explore_feed",
        wait_until="domcontentloaded",
        timeout=30_000,
    )
    page.screenshot(path=str(verification_path), full_page=True)
    print(f"VISIBLE_XHS_URL={page.url}", flush=True)
    print(f"VERIFICATION_IMAGE_PATH={verification_path}", flush=True)
    print("请在可见 Camoufox 窗口完成安全验证。", flush=True)

    deadline = time.time() + 300
    while time.time() < deadline:
        current_url = page.url.lower()
        if "website-login/captcha" not in current_url and "verifyuuid=" not in current_url:
            time.sleep(3)
            cookies = {
                item["name"]: item["value"]
                for item in page.context.cookies()
                if "xiaohongshu.com" in item.get("domain", "")
            }
            auth.save_cookies("; ".join(f"{key}={value}" for key, value in cookies.items()))
            print("XHS_VERIFICATION_SUCCESS", flush=True)
            break
        time.sleep(1)
    else:
        raise RuntimeError("安全验证等待超过 5 分钟")
