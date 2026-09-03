import { PaintDocument } from "./editor/document.js";
import { Renderer } from "./editor/renderer.js";
import { Tools } from "./editor/tools.js";
import { clamp } from "./editor/geometry.js";
import {
  downloadPng,
  loadDraft,
  removeDraft,
  restoreDocument,
  snapshotDocument,
  storeDraft,
} from "./editor/persistence.js";

const $ = (selector) => document.querySelector(selector);
const icons = {
  brush:
    '<path d="m14 4 6 6-9 9-6-6zM14 4l3-3 6 6-3 3M5 13c-4 0-1 6-4 8 5 1 9-1 8-4"/>',
  pencil: '<path d="m16 3 5 5-13 13-6 1 1-6zM13 6l5 5M3 16l5 5"/>',
  eraser: '<path d="m13 3 8 8-10 10H7l-6-6zM8 8l8 8M11 21h11"/>',
  fill: '<path d="m4 8 8-6 9 9-10 10L1 11zM4 8l13 9M8 1l8 8M20 16s-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4Z"/>',
  eyedropper:
    '<path d="m14 7 4-4a3 3 0 0 1 4 4l-4 4M12 5l7 7M14 8 3 19l-1 3 3-1L16 10M5 17l2 2"/>',
  line: '<path d="M4 20 20 4"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="4" r="2"/>',
  rectangle: '<rect x="3" y="5" width="18" height="14" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="10" ry="8"/>',
  text: '<path d="M3 6V3h18v3M12 3v18M8 21h8"/>',
  select: '<rect x="3" y="3" width="18" height="18" stroke-dasharray="3 3"/>',
  hand: '<path d="M8 13V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v7-4a2 2 0 0 1 3 0v7c0 5-3 7-8 7-3 0-5-2-7-4L3 13a2 2 0 0 1 3-3z"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a7 7 0 0 1 0 14"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H10a7 7 0 0 0 0 14"/>',
  panels:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18M3 8h12"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  up: '<path d="m5 15 7-7 7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/>',
  hidden:
    '<path d="m3 3 18 18M9 5c8-2 14 7 14 7a23 23 0 0 1-5 5M6 6a24 24 0 0 0-5 6s4 7 11 7c2 0 3 0 5-1"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.brush}</svg>`;
for (const element of document.querySelectorAll("[data-icon]"))
  element.innerHTML = icon(element.dataset.icon);
const toolDefinitions = [
  ["brush", "Brush", "B", "Drag to paint. [ ] changes size."],
  ["pencil", "Pencil", "P", "Hard-edged strokes for precise details."],
  ["eraser", "Eraser", "E", "Erase pixels from the selected layer."],
  ["fill", "Fill", "G", "Fill a connected area on the selected layer."],
  ["eyedropper", "Picker", "I", "Sample a color from the visible artwork."],
  ["line", "Line", "L", "Drag a line. Hold Shift for 45° angles."],
  ["rectangle", "Rectangle", "R", "Drag a rectangle. Hold Shift for a square."],
  ["ellipse", "Ellipse", "O", "Drag an ellipse. Hold Shift for a circle."],
  ["text", "Text", "T", "Click the canvas to add text. Enter applies it."],
  [
    "select",
    "Select",
    "M",
    "Drag a rectangle, then drag inside to move pixels.",
  ],
  ["hand", "Hand", "H", "Drag to pan. Space temporarily uses the Hand tool."],
];
const swatches = [
  ["White", "#ffffff"],
  ["Mist", "#c3c8d2"],
  ["Slate", "#737c90"],
  ["Ink", "#252936"],
  ["Coral", "#ee797d"],
  ["Red", "#dc4949"],
  ["Gold", "#ecac49"],
  ["Yellow", "#f6d65b"],
  ["Lime", "#aaca68"],
  ["Green", "#579f75"],
  ["Teal", "#448f96"],
  ["Sky", "#72b7e3"],
  ["Blue", "#537dc4"],
  ["Indigo", "#6963b9"],
  ["Violet", "#a18bc9"],
  ["Rose", "#c981a5"],
];
let doc = new PaintDocument(),
  savedDraft = null,
  busy = true,
  toastTimer,
  hue = 230,
  layerOpacityBefore = null;
const settings = {
  tool: "brush",
  color: "#252936",
  size: 12,
  opacity: 1,
  shapeMode: "outline",
  tolerance: 16,
  fontSize: 48,
  font: "Arial, sans-serif",
};
const renderer = new Renderer(
  $("#canvas-viewport"),
  $("#artboard"),
  $("#drawing-canvas"),
  $("#overlay-canvas"),
  () => doc,
  (scale, fitted) => {
    $("#zoom-value").textContent = `${Math.round(scale * 100)}%`;
    $("#fit-button").classList.toggle("isActive", fitted);
  },
);
const tools = new Tools({
  renderer,
  getDocument: () => doc,
  settings,
  isBusy: () => busy,
  notify,
  onSelection: () => availability(),
  onText: () => availability(),
  onColor: () => {
    syncColorPicker();
    render();
  },
  textEntry: $("#text-entry"),
});

for (const [name, label, key] of toolDefinitions) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toolButton";
  button.dataset.tool = name;
  button.setAttribute("aria-label", `${label} tool`);
  button.title = `${label} (${key})`;
  button.innerHTML = `${icon(name)}<span>${label}</span>`;
  button.addEventListener("click", () => setTool(name));
  $("#tools").append(button);
}
for (const [name, color] of swatches) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "swatchButton";
  button.style.setProperty("--swatch", color);
  button.dataset.color = color;
  button.setAttribute("aria-label", name);
  button.title = `${name} · ${color}`;
  button.addEventListener("click", () => {
    if (!busy) {
      settings.color = color;
      syncColorPicker();
      render();
    }
  });
  $("#swatches").append(button);
}

function notify(message) {
  $("#status-message").textContent = message;
  $("#status-message").title = message;
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 5500);
}
function setBusy(value) {
  busy = value;
  $("#editor-workspace").inert = value;
  $("#tool-options").inert = value;
  $("#document-name").disabled = value;
  for (const trigger of document.querySelectorAll(".menuTrigger"))
    trigger.disabled = value;
  availability();
}
function availability() {
  for (const button of document.querySelectorAll("[data-action]")) {
    const action = button.dataset.action;
    button.disabled =
      busy ||
      (action === "undo" && !doc.history.canUndo) ||
      (action === "redo" && !doc.history.canRedo) ||
      (["duplicate-selection", "delete-selection", "deselect"].includes(
        action,
      ) &&
        !tools.selection) ||
      (["add-layer", "duplicate-layer"].includes(action) &&
        doc.layers.length >= 8) ||
      (action === "layer-up" &&
        doc.layers.indexOf(doc.active) === doc.layers.length - 1) ||
      (action === "layer-down" && doc.layers.indexOf(doc.active) === 0);
  }
}
function setTool(name) {
  if (busy) return;
  tools.cancel();
  tools.commitText();
  if (name !== "select") tools.deselect();
  settings.tool = name;
  $("#canvas-viewport").classList.toggle("isHand", name === "hand");
  render();
}
function renderLayers() {
  const fragment = document.createDocumentFragment();
  for (const layer of [...doc.layers].reverse()) {
    const row = document.createElement("div");
    row.className = `layerRow${layer.id === doc.activeId ? " isActive" : ""}${layer.visible ? "" : " isHidden"}`;
    row.draggable = true;
    row.dataset.layerId = layer.id;
    row.addEventListener("dragstart", (event) =>
      event.dataTransfer.setData("text/sketch-layer", layer.id),
    );
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!busy) {
        tools.deselect();
        doc.reorderLayer(
          event.dataTransfer.getData("text/sketch-layer"),
          doc.layers.indexOf(layer),
        );
      }
    });
    const visibility = document.createElement("button");
    visibility.className = "iconButton";
    visibility.title = layer.visible ? "Hide layer" : "Show layer";
    visibility.setAttribute(
      "aria-label",
      `${layer.visible ? "Hide" : "Show"} ${layer.name}`,
    );
    visibility.innerHTML = icon(layer.visible ? "eye" : "hidden");
    visibility.addEventListener("click", () =>
      doc.editMetadata("Layer visibility", layer, "visible", !layer.visible),
    );
    const select = document.createElement("button");
    select.className = "layerSelect";
    select.setAttribute("aria-label", `Select ${layer.name}`);
    select.setAttribute("aria-pressed", String(layer.id === doc.activeId));
    const thumb = document.createElement("canvas");
    thumb.width = 64;
    thumb.height = 48;
    thumb.setAttribute("aria-hidden", "true");
    thumb.getContext("2d").drawImage(layer.canvas, 0, 0, 64, 48);
    const label = document.createElement("span");
    label.textContent = layer.name;
    select.append(thumb, label);
    select.addEventListener("click", () => {
      tools.commitText();
      tools.deselect();
      doc.activeId = layer.id;
      layerOpacityBefore = null;
      render();
    });
    row.append(visibility, select);
    fragment.append(row);
  }
  $("#layer-list").replaceChildren(fragment);
  $("#layer-count").textContent = `${doc.layers.length} / 8`;
  if (document.activeElement !== $("#layer-name"))
    $("#layer-name").value = doc.active.name;
  $("#layer-opacity").value = Math.round(doc.active.opacity * 100);
  $("#layer-opacity-output").textContent =
    `${Math.round(doc.active.opacity * 100)}%`;
}
function renderHistory() {
  const fragment = document.createDocumentFragment();
  const entries = [
    { label: doc.history.baseToken ? "Earlier edits" : "New document" },
    ...doc.history.entries,
  ];
  entries.forEach((entry, index) => {
    const button = document.createElement("button");
    button.className = `historyStep${index === doc.history.position ? " isCurrent" : ""}${index > doc.history.position ? " isFuture" : ""}`;
    button.setAttribute(
      "aria-current",
      index === doc.history.position ? "step" : "false",
    );
    const number = document.createElement("span");
    number.textContent = String(index).padStart(2, "0");
    button.append(number, document.createTextNode(entry.label));
    button.addEventListener("click", () => {
      tools.cancel();
      tools.cancelText();
      tools.deselect();
      doc.history.goTo(index);
    });
    fragment.append(button);
  });
  $("#history-list").replaceChildren(fragment);
}
function render() {
  renderer.render();
  if (tools.selection && tools.selection.layerId !== doc.activeId)
    tools.deselect();
  const definition = toolDefinitions.find((item) => item[0] === settings.tool);
  $("#current-tool").textContent = definition[1];
  $("#tool-hint").textContent = definition[3];
  for (const element of document.querySelectorAll("[data-tools]"))
    element.hidden = !element.dataset.tools.split(" ").includes(settings.tool);
  for (const button of document.querySelectorAll("[data-tool]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.tool === settings.tool),
    );
  for (const button of document.querySelectorAll("[data-color]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.color === settings.color),
    );
  $("#foreground-swatch").style.backgroundColor = settings.color;
  $("#large-swatch").style.backgroundColor = settings.color;
  $("#color-hex").value = settings.color;
  $("#color-name").textContent =
    swatches.find((item) => item[1] === settings.color)?.[0] || "Custom";
  $("#size-output").textContent = `${settings.size} px`;
  $("#brush-size").value = settings.size;
  $("#opacity-output").textContent = `${Math.round(settings.opacity * 100)}%`;
  $("#tolerance-output").textContent = settings.tolerance;
  $("#save-indicator").textContent = busy
    ? "Loading…"
    : doc.history.dirty
      ? "Unsaved changes"
      : "Saved draft";
  $("#save-indicator").classList.toggle("isSaved", !doc.history.dirty);
  if (document.activeElement !== $("#document-name"))
    $("#document-name").value = doc.name;
  $("#document-tab-name").textContent =
    `${doc.name}${doc.history.dirty ? " •" : ""}`;
  renderLayers();
  renderHistory();
  availability();
}
function bindDocument() {
  doc.addEventListener("change", render);
}
function resetOverlays() {
  tools.cancel();
  tools.cancelText();
  tools.deselect();
}
async function save() {
  if (busy) return;
  tools.commitText();
  if (tools.gesture) {
    notify("Finish the current stroke before saving.");
    return;
  }
  setBusy(true);
  $("#save-indicator").textContent = "Saving…";
  try {
    const draft = {
      version: 2,
      savedAt: new Date().toISOString(),
      document: await snapshotDocument(doc),
    };
    await storeDraft(draft);
    savedDraft = draft;
    doc.history.markSaved();
    notify(
      "Draft saved. Your layers will be restored when you reload this workspace.",
    );
  } catch (error) {
    notify(
      `Could not save the draft: ${error.message || "Browser storage is unavailable."}`,
    );
  } finally {
    setBusy(false);
    render();
  }
}
async function newDocument() {
  if (busy) return;
  tools.commitText();
  if (doc.history.dirty && doc.history.token !== 0) {
    $("#new-dialog").showModal();
    return;
  }
  await discardDocument();
}
async function discardDocument() {
  resetOverlays();
  setBusy(true);
  try {
    await removeDraft();
    doc.removeEventListener("change", render);
    doc = new PaintDocument();
    savedDraft = null;
    bindDocument();
    renderer.fit();
  } catch (error) {
    notify(`Could not clear the saved draft: ${error.message}`);
  } finally {
    setBusy(false);
    render();
  }
}
$("#new-dialog").addEventListener("close", () => {
  if ($("#new-dialog").returnValue === "discard") void discardDocument();
});
function toggleInspector() {
  const workspace = $("#editor-workspace");
  if (matchMedia("(max-width: 850px)").matches) {
    workspace.classList.toggle("inspectorOpen");
    workspace.classList.remove("inspectorHidden");
  } else workspace.classList.toggle("inspectorHidden");
}
function action(name) {
  if (busy) return;
  closeMenus();
  if (name === "save") {
    void save();
    return;
  }
  if (name === "new") {
    void newDocument();
    return;
  }
  if (name === "commit-text") {
    tools.commitText();
    return;
  }
  if (name === "cancel-text") {
    tools.cancelText();
    return;
  }
  if (name === "export") {
    tools.commitText();
    downloadPng(doc);
    notify("PNG exported at 1024 × 768 pixels.");
    return;
  }
  if (name === "fit") {
    renderer.fit();
    tools.overlay();
    return;
  }
  if (name === "actual-size") {
    renderer.zoom(1);
    tools.overlay();
    return;
  }
  if (name === "zoom-in" || name === "zoom-out") {
    renderer.zoom(renderer.view.scale * (name === "zoom-in" ? 1.25 : 0.8));
    tools.overlay();
    return;
  }
  if (name === "inspector") {
    toggleInspector();
    return;
  }
  if (name === "select-all") {
    setTool("select");
    tools.selectAll();
    return;
  }
  if (name === "deselect") {
    tools.deselect();
    return;
  }
  if (name === "duplicate-selection" || name === "delete-selection") {
    tools.editSelection(name === "duplicate-selection");
    return;
  }
  resetOverlays();
  if (name === "undo") doc.history.undo();
  if (name === "redo") doc.history.redo();
  if (name === "clear") doc.clearLayer();
  if (name === "add-layer" || name === "duplicate-layer")
    doc.addLayer(name === "duplicate-layer");
  if (name === "delete-layer") doc.deleteLayer();
  if (name === "layer-up" || name === "layer-down")
    doc.reorderLayer(
      doc.activeId,
      doc.layers.indexOf(doc.active) + (name === "layer-up" ? 1 : -1),
    );
}
for (const button of document.querySelectorAll("[data-action]"))
  button.addEventListener("click", () => action(button.dataset.action));
$(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  action("fit");
});
$("#document-name").addEventListener("change", (event) => {
  doc.editMetadata(
    "Rename document",
    doc,
    "name",
    event.target.value.trim() || "Untitled",
  );
  render();
});
$("#layer-name").addEventListener("change", (event) => {
  doc.editMetadata(
    "Rename layer",
    doc.active,
    "name",
    event.target.value.trim() || "Layer",
  );
  render();
});
$("#layer-opacity").addEventListener("input", (event) => {
  if (layerOpacityBefore === null) layerOpacityBefore = doc.active.opacity;
  doc.active.opacity = Number(event.target.value) / 100;
  $("#layer-opacity-output").textContent = `${event.target.value}%`;
  renderer.render();
});
$("#layer-opacity").addEventListener("change", () => {
  const value = doc.active.opacity;
  doc.active.opacity = layerOpacityBefore ?? value;
  layerOpacityBefore = null;
  doc.editMetadata("Layer opacity", doc.active, "opacity", value);
});
$("#brush-size").addEventListener("input", (event) => {
  settings.size = Number(event.target.value);
  $("#size-output").textContent = `${settings.size} px`;
});
$("#brush-opacity").addEventListener("input", (event) => {
  settings.opacity = Number(event.target.value) / 100;
  $("#opacity-output").textContent = `${event.target.value}%`;
});
$("#fill-tolerance").addEventListener("input", (event) => {
  settings.tolerance = Number(event.target.value);
  $("#tolerance-output").textContent = settings.tolerance;
});
$("#shape-mode").addEventListener("change", (event) => {
  settings.shapeMode = event.target.value;
});
$("#font-size").addEventListener("change", (event) => {
  tools.commitText();
  settings.fontSize = clamp(Number(event.target.value) || 48, 12, 144);
  event.target.value = settings.fontSize;
});
$("#font-family").addEventListener("change", (event) => {
  tools.commitText();
  settings.font = event.target.value;
});
$("#color-hex").addEventListener("change", (event) => {
  const value = event.target.value.startsWith("#")
    ? event.target.value.toLowerCase()
    : `#${event.target.value.toLowerCase()}`;
  if (/^#[0-9a-f]{6}$/.test(value)) {
    settings.color = value;
    syncColorPicker();
    render();
  } else {
    event.target.value = settings.color;
    notify("Enter a six-digit hex color, such as #537dc4.");
  }
});
function hslHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  return `#${[0, 8, 4]
    .map((n) => {
      const k = (n + h / 30) % 12;
      const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(value * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}
function syncColorPicker() {
  const rgb = [1, 3, 5].map(
      (index) => parseInt(settings.color.slice(index, index + 2), 16) / 255,
    ),
    max = Math.max(...rgb),
    min = Math.min(...rgb),
    delta = max - min,
    l = (max + min) / 2;
  if (delta) {
    hue =
      (max === rgb[0]
        ? ((rgb[1] - rgb[2]) / delta) % 6
        : max === rgb[1]
          ? (rgb[2] - rgb[0]) / delta + 2
          : (rgb[0] - rgb[1]) / delta + 4) * 60;
    hue = (hue + 360) % 360;
  }
  $("#color-saturation").value =
    delta === 0 ? 0 : Math.round((delta / (1 - Math.abs(2 * l - 1))) * 100);
  $("#color-lightness").value = Math.round(l * 100);
  updateHueMarker();
}
function updateHueMarker() {
  $("#hue-marker").style.left = `calc(${(hue / 359) * 100}% - 3px)`;
  $("#color-spectrum").setAttribute("aria-valuenow", String(Math.round(hue)));
}
function chooseHsl() {
  settings.color = hslHex(
    hue,
    Number($("#color-saturation").value),
    Number($("#color-lightness").value),
  );
  updateHueMarker();
  render();
}
const spectrum = $("#color-spectrum");
spectrum.addEventListener("pointerdown", (event) => {
  spectrum.setPointerCapture(event.pointerId);
  pickHue(event);
});
spectrum.addEventListener("pointermove", (event) => {
  if (spectrum.hasPointerCapture(event.pointerId)) pickHue(event);
});
function pickHue(event) {
  const rect = spectrum.getBoundingClientRect();
  hue = clamp(((event.clientX - rect.left) / rect.width) * 359, 0, 359);
  chooseHsl();
}
spectrum.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    hue =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 359
          : clamp(hue + (event.key === "ArrowRight" ? 5 : -5), 0, 359);
    chooseHsl();
  }
});
for (const id of ["color-saturation", "color-lightness"])
  $(`#${id}`).addEventListener("input", chooseHsl);
function selectInspectorTab(tab) {
  for (const id of ["layers", "history"]) {
    const selected = id === tab;
    $(`#${id}-tab`).setAttribute("aria-selected", String(selected));
    $(`#${id}-tab`).tabIndex = selected ? 0 : -1;
    $(`#${id}-panel`).hidden = !selected;
  }
}
for (const id of ["layers", "history"]) {
  $(`#${id}-tab`).addEventListener("click", () => selectInspectorTab(id));
  $(`#${id}-tab`).addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? "layers"
          : event.key === "End"
            ? "history"
            : id === "layers"
              ? "history"
              : "layers";
      selectInspectorTab(next);
      $(`#${next}-tab`).focus();
    }
  });
}
function closeMenus(focus = false) {
  for (const trigger of document.querySelectorAll(".menuTrigger")) {
    const popup = document.getElementById(
      trigger.getAttribute("aria-controls"),
    );
    if (!popup.hidden && focus) trigger.focus();
    popup.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }
}
for (const trigger of document.querySelectorAll(".menuTrigger")) {
  const popup = document.getElementById(trigger.getAttribute("aria-controls"));
  const open = () => {
    closeMenus();
    popup.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  };
  trigger.addEventListener("click", () => {
    if (popup.hidden) open();
    else closeMenus();
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open();
      popup.querySelector("button:not(:disabled)")?.focus();
    }
  });
  popup.addEventListener("keydown", (event) => {
    const buttons = [...popup.querySelectorAll("button:not(:disabled)")],
      current = buttons.indexOf(document.activeElement);
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                buttons.length) %
              buttons.length;
      buttons[index]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenus(true);
    } else if (event.key === "Tab") closeMenus();
  });
}
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".menu")) closeMenus();
});
document.addEventListener("keydown", (event) => {
  if (
    busy ||
    $("#new-dialog").open ||
    event.target.closest("input,textarea,select,[role=menu]")
  )
    return;
  const key = event.key.toLowerCase(),
    modifier = event.metaKey || event.ctrlKey;
  if (modifier) {
    const commands = {
      z: event.shiftKey ? "redo" : "undo",
      y: "redo",
      s: "save",
      n: "new",
      a: "select-all",
      d: "duplicate-selection",
      "+": "zoom-in",
      "=": "zoom-in",
      "-": "zoom-out",
      0: "fit",
      1: "actual-size",
    };
    if (commands[key]) {
      event.preventDefault();
      action(commands[key]);
    }
    return;
  }
  if (key === "escape") {
    closeMenus(true);
    resetOverlays();
    return;
  }
  if (key === " ") {
    event.preventDefault();
    tools.space = true;
    $("#canvas-viewport").classList.add("isHand");
    return;
  }
  if (key === "delete" || key === "backspace") {
    event.preventDefault();
    action("delete-selection");
    return;
  }
  if (key === "[" || key === "]") {
    event.preventDefault();
    settings.size = clamp(settings.size + (key === "[" ? -2 : 2), 1, 64);
    render();
    return;
  }
  const tool = toolDefinitions.find((item) => item[2].toLowerCase() === key);
  if (tool) {
    event.preventDefault();
    setTool(tool[0]);
  }
});
document.addEventListener("keyup", (event) => {
  if (event.key === " ") {
    tools.space = false;
    $("#canvas-viewport").classList.toggle("isHand", settings.tool === "hand");
  }
});

window.__paintLabReady = false;
window.__paintReadDocumentSnapshot = async () => {
  if (busy || tools.gesture || tools.textPoint || layerOpacityBefore !== null)
    throw new Error("The document has an unfinished edit.");
  return snapshotDocument(doc);
};
window.__paintReadSaveRecord = () =>
  savedDraft ? structuredClone(savedDraft) : null;

bindDocument();
syncColorPicker();
render();
setBusy(true);
renderer.fit();
try {
  const draft = await loadDraft();
  if (draft) {
    const restored = await restoreDocument(draft);
    doc.removeEventListener("change", render);
    doc = restored;
    savedDraft = draft;
    bindDocument();
  }
} catch (error) {
  notify(
    `Could not restore the saved draft: ${error.message}. You can start a new drawing or export your work.`,
  );
} finally {
  setBusy(false);
  render();
  renderer.renderNow();
  renderer.fit();
  window.__paintLabReady = true;
}
