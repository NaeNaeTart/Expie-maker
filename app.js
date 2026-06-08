/* Expie Maker – Casualties: Unknown Skin Maker
 * Pixel-art editor for head & body sprites.
 * Pure vanilla JS, no dependencies (except zip.js for export). */

(function () {
  "use strict";

  // ─── State ──────────────────────────────────────────────────────────
  let manifest = null;       // loaded from assets/manifest.json
  let partData = {};         // name → { w, h, pixels: Uint8ClampedArray (RGBA), base: Uint8ClampedArray, edited: boolean }
  let currentPart = null;    // name string
  let tool = "pencil";       // pencil | eraser | fill | picker
  let color = { r: 91, g: 140, b: 255, a: 255 };  // current draw color
  let zoom = 18;
  let showGrid = true;
  let isDrawing = false;
  let lastPx = null;         // {x,y} for line interpolation
  let undoStacks = {};       // name → [ Uint8ClampedArray ]
  let redoStacks = {};
  const MAX_UNDO = 60;

  const DEFAULT_PALETTE = [
    "#000000","#ffffff","#5b8cff","#ff6b6b","#41d18b","#f5c542","#c77dff","#ff9340",
    "#222034","#45283c","#663931","#8f563b","#df7126","#d9a066","#eec39a","#fbf236",
    "#99e550","#6abe30","#37946e","#4b692f","#524b24","#323c39","#3f3f74","#306082",
    "#5b6ee1","#639bff","#5fcde4","#cbdbfc","#9badb7","#847e87","#696a6a","#595652",
  ];

  // ─── DOM refs ───────────────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const partsListEl = $("#partsList");
  const editCanvas = $("#editCanvas");
  const bgCanvas = $("#bgCanvas");
  const gridCanvas = $("#gridCanvas");
  const editCtx = editCanvas.getContext("2d");
  const bgCtx = bgCanvas.getContext("2d");
  const gridCtx = gridCanvas.getContext("2d");
  const colorPicker = $("#colorPicker");
  const colorHex = $("#colorHex");
  const alphaSlider = $("#alpha");
  const paletteEl = $("#palette");
  const previewCanvas = $("#previewCanvas");
  const previewCtx = previewCanvas.getContext("2d");
  const previewHead = $("#previewHead");
  const previewEyes = $("#previewEyes");
  const zoomSlider = $("#zoom");
  const gridToggle = $("#gridToggle");

  // ─── Helpers ────────────────────────────────────────────────────────
  function rgbaToHex(r, g, b) {
    return "#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
  }
  function hexToRgb(hex) {
    const v = parseInt(hex.replace("#", ""), 16);
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  }
  function colorsMatch(p, i, r, g, b, a) {
    return p[i] === r && p[i + 1] === g && p[i + 2] === b && p[i + 3] === a;
  }
  function toast(msg, type) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast" + (type ? " " + type : "");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2500);
  }

  // ─── Load manifest + base PNGs ──────────────────────────────────────
  async function init() {
    manifest = await (await fetch("assets/manifest.json")).json();

    // Load all base PNGs in parallel
    await Promise.all(manifest.parts.map(async (p) => {
      const img = new Image();
      img.src = `assets/base-skin/${p.folder}/${p.name}.png`;
      await img.decode();
      const c = new OffscreenCanvas(p.width, p.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, p.width, p.height);
      partData[p.name] = {
        w: p.width, h: p.height,
        pixels: new Uint8ClampedArray(id.data),
        base: new Uint8ClampedArray(id.data), // immutable copy
        edited: false,
      };
      undoStacks[p.name] = [];
      redoStacks[p.name] = [];
    }));

    buildPartsList();
    buildPalette();
    buildPreviewSelects();
    selectPart(manifest.parts[0].name);
    setTool("pencil");
    bindEvents();
    updatePreview();
  }

  // ─── Parts list ────────────────────────────────────────────────────
  function buildPartsList() {
    partsListEl.innerHTML = "";
    let lastGroup = null;
    for (const p of manifest.parts) {
      if (p.group !== lastGroup) {
        const h = document.createElement("div");
        h.className = "parts-group-title";
        h.textContent = p.group;
        partsListEl.appendChild(h);
        lastGroup = p.group;
      }
      const item = document.createElement("div");
      item.className = "part-item";
      item.dataset.name = p.name;
      item.innerHTML = `
        <canvas class="part-thumb" width="34" height="34" data-name="${p.name}"></canvas>
        <div class="part-meta">
          <span class="part-name">${p.label}</span>
          <span class="part-dims">${p.width}×${p.height} · ${p.folder}</span>
        </div>`;
      item.addEventListener("click", () => selectPart(p.name));
      partsListEl.appendChild(item);
      drawThumb(p.name);
    }
  }

  function drawThumb(name) {
    const canvas = partsListEl.querySelector(`canvas[data-name="${name}"]`);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const d = partData[name];
    ctx.clearRect(0, 0, 34, 34);
    const oc = new OffscreenCanvas(d.w, d.h);
    const octx = oc.getContext("2d");
    octx.putImageData(new ImageData(new Uint8ClampedArray(d.pixels), d.w, d.h), 0, 0);
    const scale = Math.min(30 / d.w, 30 / d.h);
    const x = (34 - d.w * scale) / 2;
    const y = (34 - d.h * scale) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(oc, x, y, d.w * scale, d.h * scale);
  }

  function markPartEdited(name) {
    const item = partsListEl.querySelector(`.part-item[data-name="${name}"]`);
    if (item && partData[name].edited) {
      const dims = item.querySelector(".part-dims");
      if (!dims.querySelector(".part-edited")) {
        dims.insertAdjacentHTML("beforeend", '<span class="part-edited"> · edited</span>');
      }
    }
  }

  // ─── Select part ───────────────────────────────────────────────────
  function selectPart(name) {
    currentPart = name;
    partsListEl.querySelectorAll(".part-item").forEach(el => {
      el.classList.toggle("active", el.dataset.name === name);
    });
    const p = manifest.parts.find(x => x.name === name);
    const d = partData[name];
    $("#partTitle").textContent = p.label;
    $("#partDims").textContent = `${d.w}×${d.h} · ${p.folder}`;
    renderCanvases();
  }

  // ─── Render editor canvases ────────────────────────────────────────
  function renderCanvases() {
    const d = partData[currentPart];
    const w = d.w * zoom, h = d.h * zoom;
    for (const c of [editCanvas, bgCanvas, gridCanvas]) {
      c.width = w; c.height = h;
      c.style.width = w + "px"; c.style.height = h + "px";
    }
    drawBg(d.w, d.h, w, h);
    drawPixels();
    drawGrid(d.w, d.h, w, h);
  }

  function drawBg(pw, ph, w, h) {
    bgCtx.clearRect(0, 0, w, h);
    const s = zoom;
    const c1 = "#2e333f", c2 = "#262b38";
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        bgCtx.fillStyle = (x + y) % 2 === 0 ? c1 : c2;
        bgCtx.fillRect(x * s, y * s, s, s);
      }
    }
  }

  function drawPixels() {
    const d = partData[currentPart];
    const id = new ImageData(new Uint8ClampedArray(d.pixels), d.w, d.h);
    const oc = new OffscreenCanvas(d.w, d.h);
    oc.getContext("2d").putImageData(id, 0, 0);
    editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
    editCtx.imageSmoothingEnabled = false;
    editCtx.drawImage(oc, 0, 0, editCanvas.width, editCanvas.height);
  }

  function drawGrid(pw, ph, w, h) {
    gridCtx.clearRect(0, 0, w, h);
    if (!showGrid || zoom < 6) return;
    gridCtx.strokeStyle = "rgba(255,255,255,0.08)";
    gridCtx.lineWidth = 1;
    gridCtx.beginPath();
    for (let x = 0; x <= pw; x++) {
      gridCtx.moveTo(x * zoom + 0.5, 0);
      gridCtx.lineTo(x * zoom + 0.5, h);
    }
    for (let y = 0; y <= ph; y++) {
      gridCtx.moveTo(0, y * zoom + 0.5);
      gridCtx.lineTo(w, y * zoom + 0.5);
    }
    gridCtx.stroke();
  }

  // ─── Pixel operations ──────────────────────────────────────────────
  function pixelAt(name, x, y) {
    const d = partData[name]; const i = (y * d.w + x) * 4;
    return { r: d.pixels[i], g: d.pixels[i + 1], b: d.pixels[i + 2], a: d.pixels[i + 3] };
  }
  function setPixel(name, x, y, r, g, b, a) {
    const d = partData[name]; const i = (y * d.w + x) * 4;
    d.pixels[i] = r; d.pixels[i + 1] = g; d.pixels[i + 2] = b; d.pixels[i + 3] = a;
  }

  function pushUndo(name) {
    const d = partData[name];
    undoStacks[name].push(new Uint8ClampedArray(d.pixels));
    if (undoStacks[name].length > MAX_UNDO) undoStacks[name].shift();
    redoStacks[name] = [];
  }

  function undo() {
    if (!currentPart) return;
    const stack = undoStacks[currentPart];
    if (stack.length === 0) return;
    const d = partData[currentPart];
    redoStacks[currentPart].push(new Uint8ClampedArray(d.pixels));
    d.pixels = stack.pop();
    drawPixels(); drawThumb(currentPart); updatePreview();
  }
  function redo() {
    if (!currentPart) return;
    const stack = redoStacks[currentPart];
    if (stack.length === 0) return;
    const d = partData[currentPart];
    undoStacks[currentPart].push(new Uint8ClampedArray(d.pixels));
    d.pixels = stack.pop();
    drawPixels(); drawThumb(currentPart); updatePreview();
  }

  function floodFill(name, sx, sy, tr, tg, tb, ta) {
    const d = partData[name];
    const px = d.pixels;
    const si = (sy * d.w + sx) * 4;
    const sr = px[si], sg = px[si + 1], sb = px[si + 2], sa = px[si + 3];
    if (sr === tr && sg === tg && sb === tb && sa === ta) return;
    const stack = [[sx, sy]];
    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      const ci = (cy * d.w + cx) * 4;
      if (!colorsMatch(px, ci, sr, sg, sb, sa)) continue;
      px[ci] = tr; px[ci + 1] = tg; px[ci + 2] = tb; px[ci + 3] = ta;
      if (cx > 0) stack.push([cx - 1, cy]);
      if (cx < d.w - 1) stack.push([cx + 1, cy]);
      if (cy > 0) stack.push([cx, cy - 1]);
      if (cy < d.h - 1) stack.push([cx, cy + 1]);
    }
  }

  // ─── Drawing events ────────────────────────────────────────────────
  function canvasCoords(e) {
    const rect = editCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / zoom);
    const y = Math.floor((e.clientY - rect.top) / zoom);
    return { x, y };
  }

  function applyTool(px, py) {
    const d = partData[currentPart];
    if (px < 0 || py < 0 || px >= d.w || py >= d.h) return;
    if (tool === "pencil") {
      setPixel(currentPart, px, py, color.r, color.g, color.b, color.a);
    } else if (tool === "eraser") {
      setPixel(currentPart, px, py, 0, 0, 0, 0);
    } else if (tool === "fill") {
      floodFill(currentPart, px, py, color.r, color.g, color.b, color.a);
    } else if (tool === "picker") {
      const c = pixelAt(currentPart, px, py);
      color.r = c.r; color.g = c.g; color.b = c.b; color.a = c.a;
      syncColorUI();
      setTool("pencil");
    }
  }

  // Line interpolation (Bresenham-like)
  function plotLine(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      applyTool(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    isDrawing = true;
    const { x, y } = canvasCoords(e);
    pushUndo(currentPart);
    applyTool(x, y);
    lastPx = { x, y };
    drawPixels();
    partData[currentPart].edited = true;
    markPartEdited(currentPart);
    editCanvas.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const { x, y } = canvasCoords(e);
    const d = partData[currentPart];
    if (x >= 0 && y >= 0 && x < d.w && y < d.h) {
      $("#cursorPos").textContent = `(${x}, ${y})`;
    } else {
      $("#cursorPos").textContent = "";
    }
    if (!isDrawing) return;
    if (tool === "fill" || tool === "picker") return;
    if (lastPx) plotLine(lastPx.x, lastPx.y, x, y); else applyTool(x, y);
    lastPx = { x, y };
    drawPixels();
  }
  function onPointerUp() {
    if (!isDrawing) return;
    isDrawing = false;
    lastPx = null;
    drawThumb(currentPart);
    updatePreview();
  }

  // ─── Color ──────────────────────────────────────────────────────────
  function syncColorUI() {
    const hex = rgbaToHex(color.r, color.g, color.b);
    colorPicker.value = hex;
    colorHex.textContent = hex.toUpperCase();
    alphaSlider.value = color.a;
  }
  function buildPalette() {
    paletteEl.innerHTML = "";
    for (const hex of DEFAULT_PALETTE) {
      const s = document.createElement("div");
      s.className = "swatch";
      s.style.setProperty("--c", hex);
      s.innerHTML = `<span class="fill" style="background:${hex}"></span>`;
      s.addEventListener("click", () => {
        const c = hexToRgb(hex);
        color.r = c.r; color.g = c.g; color.b = c.b;
        syncColorUI();
      });
      paletteEl.appendChild(s);
    }
  }

  // ─── Tools ──────────────────────────────────────────────────────────
  function setTool(t) {
    tool = t;
    document.querySelectorAll(".tool").forEach(el => el.classList.toggle("active", el.dataset.tool === t));
    editCanvas.style.cursor =
      t === "pencil" ? "crosshair" :
      t === "eraser" ? "crosshair" :
      t === "fill" ? "crosshair" :
      t === "picker" ? "copy" : "default";
  }

  // ─── Face preview ──────────────────────────────────────────────────
  function buildPreviewSelects() {
    const heads = manifest.parts.filter(p => p.group === "Head Shapes");
    const eyes = manifest.parts.filter(p => p.group === "Eyes");
    previewHead.innerHTML = heads.map(p =>
      `<option value="${p.name}" ${p.name === "experimentHead" ? "selected" : ""}>${p.label}</option>`
    ).join("");
    previewEyes.innerHTML = eyes.map(p =>
      `<option value="${p.name}" ${p.name === "experimentEyeOpen" ? "selected" : ""}>${p.label}</option>`
    ).join("");
  }
  function updatePreview() {
    const hName = previewHead.value;
    const eName = previewEyes.value;
    const hd = partData[hName];
    const ed = partData[eName];
    if (!hd || !ed) return;
    const s = 8; // preview zoom
    const w = hd.w, h = hd.h;
    previewCanvas.width = w * s;
    previewCanvas.height = h * s;
    previewCanvas.style.width = w * s + "px";
    previewCanvas.style.height = h * s + "px";
    previewCtx.clearRect(0, 0, w * s, h * s);
    previewCtx.imageSmoothingEnabled = false;

    // Draw head
    const hoc = new OffscreenCanvas(hd.w, hd.h);
    hoc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(hd.pixels), hd.w, hd.h), 0, 0);
    previewCtx.drawImage(hoc, 0, 0, w * s, h * s);

    // Overlay eyes centered
    const eoc = new OffscreenCanvas(ed.w, ed.h);
    eoc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(ed.pixels), ed.w, ed.h), 0, 0);
    const ex = Math.round(((w - ed.w) / 2) * s);
    const ey = Math.round(((h - ed.h) / 2 - 1) * s); // slightly above center
    previewCtx.drawImage(eoc, ex, ey, ed.w * s, ed.h * s);
  }

  // ─── Import / Export ────────────────────────────────────────────────
  async function importPNG(name, file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const d = partData[name];
    const oc = new OffscreenCanvas(d.w, d.h);
    const ctx = oc.getContext("2d");
    ctx.drawImage(img, 0, 0, d.w, d.h);
    const id = ctx.getImageData(0, 0, d.w, d.h);
    pushUndo(name);
    d.pixels = new Uint8ClampedArray(id.data);
    d.edited = true;
    URL.revokeObjectURL(url);
    markPartEdited(name);
    drawThumb(name);
    if (name === currentPart) drawPixels();
    updatePreview();
  }

  async function importFolder(files) {
    let matched = 0;
    for (const file of files) {
      const fname = file.name.replace(/\.png$/i, "");
      if (partData[fname]) {
        await importPNG(fname, file);
        matched++;
      }
    }
    toast(matched > 0 ? `Imported ${matched} part(s)` : "No matching filenames found", matched > 0 ? "ok" : "err");
  }

  function partToBlob(name) {
    const d = partData[name];
    const oc = new OffscreenCanvas(d.w, d.h);
    oc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(d.pixels), d.w, d.h), 0, 0);
    return oc.convertToBlob({ type: "image/png" });
  }

  async function exportSkin() {
    const skinName = ($("#skinName").value || "MySkin").trim().replace(/[/\\:*?"<>|]/g, "_");
    const files = [];
    toast("Packing skin…");
    for (const p of manifest.parts) {
      // PNG
      const blob = await partToBlob(p.name);
      const ab = await blob.arrayBuffer();
      files.push({ name: `${skinName}/${p.folder}/${p.name}.png`, data: new Uint8Array(ab) });

      // .txt metadata (if the base skin has one)
      if (p.hasTxt) {
        try {
          const txt = await (await fetch(`assets/base-skin/${p.folder}/${p.name}.txt`)).text();
          files.push({ name: `${skinName}/${p.folder}/${p.name}.txt`, data: new TextEncoder().encode(txt) });
        } catch (_) { /* skip if not found */ }
      }
    }
    const zipBlob = ExpieZip.createZip(files);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url; a.download = `${skinName}.zip`; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${skinName}.zip`, "ok");
  }

  function resetPart(name) {
    const d = partData[name];
    pushUndo(name);
    d.pixels = new Uint8ClampedArray(d.base);
    d.edited = false;
    drawThumb(name);
    if (name === currentPart) drawPixels();
    updatePreview();
  }

  function resetAll() {
    if (!confirm("Reset all parts to the base Expie skin?")) return;
    for (const name of Object.keys(partData)) resetPart(name);
    toast("All parts reset to base", "ok");
  }

  // ─── Event binding ─────────────────────────────────────────────────
  function bindEvents() {
    // Canvas drawing
    editCanvas.addEventListener("pointerdown", onPointerDown);
    editCanvas.addEventListener("pointermove", onPointerMove);
    editCanvas.addEventListener("pointerup", onPointerUp);
    editCanvas.addEventListener("pointerleave", () => { $("#cursorPos").textContent = ""; });
    // Prevent context menu on canvas
    editCanvas.addEventListener("contextmenu", e => e.preventDefault());

    // Tools
    document.querySelectorAll(".tool").forEach(el =>
      el.addEventListener("click", () => setTool(el.dataset.tool))
    );

    // Color
    colorPicker.addEventListener("input", () => {
      const c = hexToRgb(colorPicker.value);
      color.r = c.r; color.g = c.g; color.b = c.b;
      syncColorUI();
    });
    alphaSlider.addEventListener("input", () => {
      color.a = parseInt(alphaSlider.value, 10);
    });
    $("#addSwatch").addEventListener("click", () => {
      const hex = rgbaToHex(color.r, color.g, color.b);
      const s = document.createElement("div");
      s.className = "swatch";
      s.style.setProperty("--c", hex);
      s.innerHTML = `<span class="fill" style="background:${hex}"></span>`;
      s.addEventListener("click", () => {
        const c = hexToRgb(hex);
        color.r = c.r; color.g = c.g; color.b = c.b;
        syncColorUI();
      });
      paletteEl.appendChild(s);
    });

    // Zoom & grid
    zoomSlider.addEventListener("input", () => {
      zoom = parseInt(zoomSlider.value, 10);
      renderCanvases();
    });
    gridToggle.addEventListener("change", () => {
      showGrid = gridToggle.checked;
      renderCanvases();
    });

    // Undo/redo
    $("#undoBtn").addEventListener("click", undo);
    $("#redoBtn").addEventListener("click", redo);
    document.addEventListener("keydown", e => {
      if (e.target.matches("input,select,textarea")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); }
      if (e.key === "b" || e.key === "B") setTool("pencil");
      if (e.key === "e" || e.key === "E") setTool("eraser");
      if (e.key === "g" || e.key === "G") setTool("fill");
      if (e.key === "i" || e.key === "I") setTool("picker");
    });

    // Import/export
    $("#importFolderBtn").addEventListener("click", () => $("#importFolder").click());
    $("#importFolder").addEventListener("change", (e) => importFolder(e.target.files));
    $("#importPartBtn").addEventListener("click", () => $("#importPart").click());
    $("#importPart").addEventListener("change", (e) => {
      if (e.target.files[0] && currentPart) {
        importPNG(currentPart, e.target.files[0]);
        toast(`Imported into ${currentPart}`, "ok");
      }
    });
    $("#partResetBtn").addEventListener("click", () => { if (currentPart) resetPart(currentPart); });
    $("#resetAllBtn").addEventListener("click", resetAll);
    $("#exportBtn").addEventListener("click", exportSkin);

    // Preview selects
    previewHead.addEventListener("change", updatePreview);
    previewEyes.addEventListener("change", updatePreview);
  }

  // ─── Init ──────────────────────────────────────────────────────────
  init().catch(err => {
    console.error("Init failed:", err);
    toast("Failed to load skin data. Check console.", "err");
  });
})();
