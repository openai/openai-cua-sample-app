import asyncio
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.browser import (
    BrowserSession,
    launch_browser_session,
    wait_for_devtools_port,
)
from app.processes import OwnedProcess, child_environment


class FakeProcess:
    def __init__(self):
        self.process = SimpleNamespace(returncode=None)
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self.close_count = 0
        self.command = None
        self.environment = None

    async def close(self):
        self.close_count += 1
        self.process.returncode = -9
        self.stdout.feed_eof()
        self.stderr.feed_eof()


@pytest.fixture
async def browser_harness(monkeypatch):
    import playwright.async_api as playwright_api

    child = FakeProcess()
    page = SimpleNamespace(
        goto=AsyncMock(),
        title=AsyncMock(return_value="The lab"),
        url="http://127.0.0.1:9999/index.html",
        bring_to_front=AsyncMock(),
        screenshot=AsyncMock(),
    )
    context = SimpleNamespace(new_page=AsyncMock(return_value=page), close=AsyncMock())
    browser = SimpleNamespace(new_context=AsyncMock(return_value=context), close=AsyncMock())
    playwright = SimpleNamespace(
        chromium=SimpleNamespace(
            executable_path="/test/chromium",
            connect_over_cdp=AsyncMock(return_value=browser),
        ),
        stop=AsyncMock(),
    )

    async def spawn(command, *, env):
        child.command = command
        child.environment = env
        profile = Path(next(arg.split("=", 1)[1] for arg in command if arg.startswith("--user-data-dir=")))
        (profile / "DevToolsActivePort").write_text("45321\n/devtools/browser/test\n")
        return child

    monkeypatch.setattr("app.browser.OwnedProcess.spawn", spawn)
    monkeypatch.setattr(
        playwright_api, "async_playwright", lambda: SimpleNamespace(start=AsyncMock(return_value=playwright))
    )
    return SimpleNamespace(child=child, page=page, context=context, browser=browser, playwright=playwright)


async def launch(tmp_path, **kwargs):
    return await launch_browser_session(
        browser_mode="headful",
        screenshot_dir=tmp_path / "screenshots",
        url="http://127.0.0.1:9999/index.html",
        target_label="Kanban lab",
        **kwargs,
    )


async def test_launch_owns_process_profile_and_uses_public_cdp_apis(browser_harness, tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "do-not-pass")
    session = await launch(tmp_path)
    assert session.target_label == "Kanban lab"
    assert session.viewport == {"height": 900, "width": 1440}
    assert "--remote-debugging-port=0" in browser_harness.child.command
    assert "--no-startup-window" in browser_harness.child.command
    assert "OPENAI_API_KEY" not in browser_harness.child.environment
    browser_harness.playwright.chromium.connect_over_cdp.assert_awaited_once_with(
        "http://127.0.0.1:45321", timeout=15000
    )
    browser_harness.browser.new_context.assert_awaited_once_with(viewport={"height": 900, "width": 1440})
    browser_harness.page.goto.assert_awaited_once_with("http://127.0.0.1:9999/index.html", wait_until="load")
    profile = session.profile
    await asyncio.gather(session.close(), session.close())
    assert browser_harness.child.close_count == 1
    assert not profile.exists()
    browser_harness.playwright.stop.assert_awaited_once()


async def test_browser_preview_metadata_and_frontmost(browser_harness, tmp_path):
    session = await launch(tmp_path)
    try:
        capture = await session.capture_screenshot("A / strange: label!")
        assert capture["currentUrl"] == browser_harness.page.url
        assert capture["pageTitle"] == "The lab"
        assert capture["path"].endswith("001-a-strange-label.png")
        assert capture["id"] == "screenshot-1"
        assert capture["capturedAt"].endswith("Z")
        await session.frontmost()
        browser_harness.page.bring_to_front.assert_awaited_once()
    finally:
        await session.close()


async def test_hung_playwright_cleanup_still_kills_owned_chromium(browser_harness, tmp_path):
    async def blocked():
        await asyncio.Future()

    browser_harness.context.close.side_effect = blocked
    session = await launch(tmp_path)
    profile = session.profile
    with pytest.raises(RuntimeError, match="cleanup exceeded 1000ms") as failure:
        await asyncio.wait_for(session.close(), 2)
    assert failure.value.code == "cleanup_failed"
    assert browser_harness.child.close_count == 1
    assert not profile.exists()
    browser_harness.browser.close.assert_awaited_once()


async def test_cleanup_deadline_does_not_wait_for_cancellation_suppression(browser_harness, tmp_path):
    killed = asyncio.Event()
    original_close = browser_harness.child.close

    async def blocked_context():
        try:
            await asyncio.Future()
        finally:
            # A driver teardown waiting on a hung browser can delay cancellation.
            await killed.wait()

    async def close_process():
        await original_close()
        killed.set()

    browser_harness.context.close.side_effect = blocked_context
    browser_harness.browser.close.side_effect = killed.wait
    browser_harness.child.close = close_process
    session = await launch(tmp_path)
    with pytest.raises(RuntimeError, match="cleanup exceeded 1000ms"):
        await asyncio.wait_for(session.close(), 2)
    assert killed.is_set()


async def test_stop_during_connect_reaps_process_and_removes_profile(browser_harness, tmp_path):
    signal = asyncio.Event()
    started = asyncio.Event()

    async def blocked(*args, **kwargs):
        started.set()
        await asyncio.Future()

    browser_harness.playwright.chromium.connect_over_cdp.side_effect = blocked
    task = asyncio.create_task(launch(tmp_path, signal=signal))
    await started.wait()
    signal.set()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 2)
    assert browser_harness.child.close_count == 1
    profile = Path(
        next(arg.split("=", 1)[1] for arg in browser_harness.child.command if arg.startswith("--user-data-dir="))
    )
    assert not profile.exists()


async def test_stop_after_launch_closes_browser_while_other_work_waits(browser_harness, tmp_path):
    signal = asyncio.Event()
    session = await launch(tmp_path, signal=signal)
    signal.set()
    await asyncio.sleep(0)
    await asyncio.wait_for(session.close(), 1)
    assert browser_harness.child.close_count == 1


async def test_devtools_endpoint_wait_reports_exit_timeout_and_cancel(tmp_path):
    child = FakeProcess()
    with pytest.raises(RuntimeError, match="not ready"):
        await wait_for_devtools_port(tmp_path, child, timeout=0.03)
    child.process.returncode = 1
    with pytest.raises(RuntimeError, match="exited"):
        await wait_for_devtools_port(tmp_path, child)
    child.process.returncode = None
    signal = asyncio.Event()
    signal.set()
    with pytest.raises(asyncio.CancelledError):
        await wait_for_devtools_port(tmp_path, child, signal)


@pytest.mark.skipif(os.environ.get("CUA_BROWSER_TESTS") != "1", reason="Opt-in real Chromium; never uses desktop input")
async def test_real_owned_chromium_cdp_operations_and_cleanup(tmp_path):
    from playwright.async_api import async_playwright

    playwright = await async_playwright().start()
    profile = tmp_path / "profile"
    profile.mkdir()
    try:
        child = await OwnedProcess.spawn(
            [
                playwright.chromium.executable_path,
                "--headless=new",
                "--no-sandbox",
                f"--user-data-dir={profile}",
                "--remote-debugging-address=127.0.0.1",
                "--remote-debugging-port=0",
                "--no-startup-window",
                "--no-first-run",
                "--no-default-browser-check",
                "--window-size=1440,900",
            ],
            env=child_environment(),
        )
    except BaseException:
        await playwright.stop()
        raise
    session = BrowserSession(
        process=child,
        playwright=playwright,
        profile=profile,
        screenshot_dir=tmp_path / "screenshots",
        target_label="CDP smoke",
        mode="headless",
        signal=None,
    )
    try:
        endpoint = await wait_for_devtools_port(profile, child)
        session.browser = await playwright.chromium.connect_over_cdp(endpoint, timeout=15_000)
        session.context = await session.browser.new_context(viewport=session.viewport)
        session.page = await session.context.new_page()
        await session.navigate("data:text/html,<title>Python CDP smoke</title><h1>Ready</h1>")
        await session.frontmost()
        await session.page.wait_for_function("document.querySelector('h1').textContent === 'Ready'")
        assert await session.page.locator("h1").inner_text() == "Ready"
        assert await session.page.evaluate("({title: document.title})") == {"title": "Python CDP smoke"}
        screenshot = await session.capture_screenshot("CDP smoke")
        assert Path(screenshot["path"]).read_bytes().startswith(b"\x89PNG")
        assert screenshot["pageTitle"] == "Python CDP smoke"
    finally:
        await session.close()
    assert not profile.exists()
    assert child.process.returncode is not None
