import time
import base64
from typing import List, Dict, Literal
from PIL import ImageGrab, Image, ImageDraw
import subprocess
from io import BytesIO
import json

class MacOSComputer:
    environment: Literal["mac"] = "mac"

    def __init__(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    # --- Common "Computer" actions ---

    def get_dimensions(self) -> tuple[int, int]:
        img = self.screenshot_raw()
        return img.size

    def get_scale_factor(self) -> float:
        result = subprocess.run(['./macos_ax', 'scale_factor'], check=True, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"Error getting scale factor using controller: {result.stderr}")
        return float(result.stdout)

    def screenshot(self) -> str:
        img = self.screenshot_raw()
        buffered = BytesIO()
        img.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode("utf-8")

    def screenshot_around(self, x: int, y: int) -> str:
        save_path = f"tmp/screenshot_around.png"
        subprocess.run(['screencapture', '-x', save_path], check=True, timeout=5)
        scale_factor = self.get_scale_factor()
        with Image.open(save_path) as img:
            x = x * scale_factor
            y = y * scale_factor

            draw = ImageDraw.Draw(img)
            draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill="red")
            # img = img.crop((x - 300, y - 80, x + 300, y + 80))
            # the above, but within the bounds of the image
            img = img.crop((max(0, x - 300), max(0, y - 80), min(img.width, x + 300), min(img.height, y + 80)))
            buffered = BytesIO()
            img.save(buffered, format="PNG")
            img.save(save_path)
            return base64.b64encode(buffered.getvalue()).decode("utf-8")

    def click(self, x: int, y: int, button: str = "left") -> None:
        button_num = {"left": "1", "right": "2", "middle": "3"}.get(button, "1")
        result = subprocess.run(['./macos_ax', 'click', '--position', f"{x},{y}"], check=True, timeout=5)
        if result.returncode != 0:
            raise Exception(f"Error clicking at coordinates using controller: {result.stderr}")

    def double_click(self, x: int, y: int) -> None:
        result = subprocess.run(['./macos_ax', 'double_click', "--position", f"{x},{y}"], check=True, timeout=5)
        if result.returncode != 0:
            raise Exception(f"Error double-clicking at coordinates using controller: {result.stderr}")

    def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        result = subprocess.run(['./macos_ax', 'scroll', "--position", f"{x},{y}", "--delta_x", f"{scroll_x}", "--delta_y", f"{scroll_y}"], check=True, timeout=5)
        if result.returncode != 0:
            raise Exception(f"Error scrolling at coordinates using controller: {result.stderr}")

    def type(self, text: str) -> None:
        result = subprocess.run(['./macos_ax', 'type', "--text", text], check=True, timeout=5)
        if result.returncode != 0:
            raise Exception(f"Error typing text using controller: {result.stderr}")

    def wait(self, ms: int = 1000) -> None:
        # time.sleep(ms / 1000)
        pass

    def move(self, x: int, y: int) -> None:
        pass

    def keypress(self, keys: List[str]) -> None:
        result = subprocess.run(['./macos_ax', 'keypress', "--keys", "+".join(keys)], check=True, timeout=5)
        if result.returncode != 0:
            raise Exception(f"Error keypressing using controller: {result.stderr}")

    def drag(self, path: List[Dict[str, int]]) -> None:
        path_string = ",".join([f"{x},{y}" for x, y in path])
        result = subprocess.run(['./macos_ax', 'drag', "--path", path_string], check=True, timeout=5)
        if result.returncode != 0:
            raise Exception(f"Error dragging at coordinates using controller: {result.stderr}")

    # Custom Actions

    def open_app(self, app_name: str) -> None:
        try:
            subprocess.run(['open', '-a', app_name], check=True, timeout=5)
        except subprocess.CalledProcessError:
            return f"{app_name} is not installed."
        return f"Opened {app_name}."

    def list_apps(self, filter: List[str] = []) -> List[str]:
        result = subprocess.run(['mdfind', 'kMDItemKind == "Application"'], check=True, timeout=5, capture_output=True, text=True)
        apps = result.stdout.split("\n")
        if filter:
            apps = [app for app in apps if any(filter_item in app for filter_item in filter)]
        return apps

    # Private

    def dock_bounding_box(self) -> Dict[str, int]:
        result = subprocess.run(['./macos_ax', 'dock_bounding_box'], check=True, timeout=5, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"Error getting dock bounding box using controller: {result.stderr}")
        return json.loads(result.stdout).get("bounding_box")

    def screenshot_raw(self) -> str:
        save_path = f"tmp/screenshot.png"
        subprocess.run(['screencapture', '-x', save_path], check=True, timeout=5)
        scale_factor = self.get_scale_factor()
        with Image.open(save_path) as img:
            img = img.resize((int(img.width / scale_factor), int(img.height / scale_factor)))

            # draw black box over dock
            dock_bounding_box = self.dock_bounding_box()
            draw = ImageDraw.Draw(img)
            draw.rectangle([dock_bounding_box["x"], dock_bounding_box["y"], dock_bounding_box["x"] + dock_bounding_box["width"], dock_bounding_box["y"] + dock_bounding_box["height"]], fill="black")

            img = img.quantize(colors=256, method=2)

            img.save(save_path)
            return img