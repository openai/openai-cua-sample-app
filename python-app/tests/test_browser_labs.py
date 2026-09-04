"""Exercise native CDP setup and lab state with Chromium; never send desktop input."""
import copy
import os
from pathlib import Path

import pytest

from app.browser import launch_browser_session
from app.lab_catalog import list_scenarios
from app.lab_server import start_workspace_lab_server
from app.processes import OwnedProcess

pytestmark = [pytest.mark.browser, pytest.mark.skipif(os.environ.get("CUA_BROWSER_TESTS") != "1", reason="Set CUA_BROWSER_TESTS=1 to run Chromium lab tests.")]


@pytest.fixture
async def session_factory(tmp_path, monkeypatch):
    spawn = OwnedProcess.spawn
    async def headless(cls, command, **kwargs):
        # Production remains headful-only. This test runs the same owned Chromium
        # and CDP code with a headless flag, without initializing PyAutoGUI.
        return await spawn([command[0], "--headless=new", "--no-sandbox", *command[1:]], **kwargs)
    monkeypatch.setattr(OwnedProcess, "spawn", classmethod(headless))
    resources = []
    async def create(lab_id):
        scenario = next(item for item in list_scenarios() if item["labId"] == lab_id)
        server = await start_workspace_lab_server(workspace_path=scenario["workspaceTemplatePath"])
        resources.append((None, server))
        session = await launch_browser_session(browser_mode="headful", screenshot_dir=tmp_path / lab_id,
            url=server.url_for(), target_label=lab_id)
        resources[-1] = (session, server)
        return session
    yield create
    for session, server in reversed(resources):
        if session:
            await session.close()
            assert session.process.process.returncode is not None
            assert not session.profile.exists()
        await server.close()


async def test_kanban_board_through_native_cdp(session_factory):
    session = await session_factory("kanban")
    target = {"backlog": ["workspace_docs"], "in_progress": ["bug_triage", "analytics_spec"],
              "done": ["launch_brief", "replay_audit", "tooltips"]}
    await session.page.evaluate("""target => {
        for (const [column, cards] of Object.entries(target)) {
            for (const card of cards) {
                const source = document.querySelector(`[data-card-id="${card}"]`);
                const destination = document.querySelector(`[data-column-id="${column}"]`);
                const dataTransfer = new DataTransfer();
                source.dispatchEvent(new DragEvent('dragstart', {dataTransfer, bubbles: true}));
                destination.dispatchEvent(new DragEvent('drop', {dataTransfer, bubbles: true, cancelable: true}));
                source.dispatchEvent(new DragEvent('dragend', {dataTransfer, bubbles: true}));
            }
        }
    }""", target)
    assert await session.page.evaluate("() => globalThis.__kanbanReadBoardState()") == target
    screenshot = await session.capture_screenshot("final-board")
    assert Path(screenshot["path"]).read_bytes().startswith(b"\x89PNG")
    assert (await session.read_state())["currentUrl"].endswith("index.html")


async def test_booking_confirmation_through_native_cdp(session_factory):
    session = await session_factory("booking")
    page = session.page
    await page.get_by_test_id("filter-neighborhood").select_option(label="Marina District")
    await page.get_by_test_id("filter-breakfast").check()
    await page.get_by_test_id("filter-workspace").check()
    await page.get_by_test_id("apply-search-filters").click()
    await page.get_by_test_id("hotel-luma_harbor-select").click()
    for field, value in {"guest-name": "Ada Lovelace", "guest-email": "ada.lovelace@example.com", "check-in": "2026-04-18",
                         "check-out": "2026-04-21", "special-request": "Late arrival after 9pm."}.items():
        await page.get_by_test_id(field).fill(value)
    await page.get_by_test_id("confirm-reservation").click()
    confirmation = await page.evaluate("() => globalThis.__bookingReadConfirmation()")
    expected = {"hotelId": "luma_harbor", "guestName": "Ada Lovelace", "guestEmail": "ada.lovelace@example.com",
                "checkIn": "2026-04-18", "checkOut": "2026-04-21", "specialRequest": "Late arrival after 9pm."}
    assert {key: confirmation[key] for key in expected} == expected
    filters = await page.evaluate("() => globalThis.__bookingReadFilters()")
    assert filters["neighborhood"] == "Marina District"
    assert filters["requireBreakfast"] is True and filters["requireWorkspace"] is True
    assert await page.get_by_test_id("booking-status").text_content() == "Reservation recorded"


async def test_paint_save_draft_preserves_pixels_and_restores_after_reload(session_factory):
    session = await session_factory("paint")
    page = session.page
    await page.wait_for_function("() => globalThis.__paintLabReady === true")
    box = await page.get_by_test_id("paint-canvas").bounding_box()
    assert box
    x, y = box["x"] + box["width"] * 0.4, box["y"] + box["height"] * 0.4
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 50, y + 40, steps=8)
    await page.mouse.up()
    await page.get_by_test_id("save-poster").click()
    await page.wait_for_function("() => globalThis.__paintReadSaveRecord() !== null")
    saved = await page.evaluate("() => globalThis.__paintReadSaveRecord()")
    assert saved is not None and saved["document"]["paintedPixelCount"] > 0
    live = await page.evaluate("() => globalThis.__paintReadDocumentSnapshot()")
    assert live == saved["document"]
    program = (Path(__file__).parent / "fixtures" / "paint_validation.js").read_text()
    assert (await page.evaluate(program, saved["document"]))["valid"] is True
    corrupted = copy.deepcopy(saved["document"])
    corrupted["layers"][0]["pixelHash"] = "0" * 64
    result = await page.evaluate(program, corrupted)
    assert result["valid"] is False and "pixel hash" in result["reason"]
    await page.reload()
    await page.wait_for_function("() => globalThis.__paintLabReady === true")
    assert await page.evaluate("() => globalThis.__paintReadSaveRecord()") == saved
    assert await page.evaluate("() => globalThis.__paintReadDocumentSnapshot()") == saved["document"]
