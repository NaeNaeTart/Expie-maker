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
  let redoStacks = {};       // name → [ Uint8ClampedArray ]
  let referenceImage = null; // Image object
  let overlayOffsetX = 0;
  let overlayOffsetY = 0;
  let overlayScale = 1.0;
  let overlayFitMode = "contain"; // stretch | contain | cover | original
  let overlayFilterInvert = false;
  let overlayFilterGrayscale = false;
  let overlayFilterTint = false;
  let overlayFilterTintColor = "#ff0000";
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
  const referenceCanvas = $("#referenceCanvas");
  const editCtx = editCanvas.getContext("2d");
  const bgCtx = bgCanvas.getContext("2d");
  const gridCtx = gridCanvas.getContext("2d");
  const colorPicker = $("#colorPicker");
  const colorHex = $("#colorHex");
  const paletteEl = $("#palette");
  const previewCanvas = $("#previewCanvas");
  const previewCtx = previewCanvas.getContext("2d");
  const previewHead = $("#previewHead");
  const previewEyes = $("#previewEyes");
  const zoomSlider = $("#zoom");
  const gridToggle = $("#gridToggle");
  const mirrorToggle = $("#mirrorToggle");

  // ─── Helpers ────────────────────────────────────────────────────────
  function rgbaToHex(r, g, b) {
    return "#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
  }
  function hexToRgb(hex) {
    const v = parseInt(hex.replace("#", ""), 16);
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h, s, l };
  }
  function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }
  function colorsMatch(p, i, r, g, b, a) {
    return p[i] === r && p[i + 1] === g && p[i + 2] === b && p[i + 3] === a;
  }
  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  function updateHistoryButtons() {
    const undoBtn = $("#undoBtn");
    const redoBtn = $("#redoBtn");
    if (!currentPart) {
      undoBtn.disabled = true;
      redoBtn.disabled = true;
      return;
    }
    undoBtn.disabled = undoStacks[currentPart].length === 0;
    redoBtn.disabled = redoStacks[currentPart].length === 0;
  }
  function updateActiveSwatch() {
    const currentHex = rgbaToHex(color.r, color.g, color.b).toLowerCase().trim();
    paletteEl.querySelectorAll(".swatch").forEach(s => {
      const swatchColor = s.style.getPropertyValue("--c").toLowerCase().trim();
      s.classList.toggle("active", swatchColor === currentHex);
    });
    const activeColorsEl = $("#activeColors");
    if (activeColorsEl) {
      activeColorsEl.querySelectorAll(".swatch").forEach(s => {
        const swatchColor = s.style.getPropertyValue("--c").toLowerCase().trim();
        s.classList.toggle("active", swatchColor === currentHex);
      });
    }
  }
  function updateCachedCanvas(name) {
    const d = partData[name];
    if (!d || !d.canvas) return;
    const ctx = d.canvas.getContext("2d");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(d.pixels), d.w, d.h), 0, 0);
    d.bbox = calculateBoundingBox(d.pixels, d.w, d.h);
  }

  function toast(msg, type) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast" + (type ? " " + type : "");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2500);
  }

  async function serializeStack(name, stack) {
    if (!stack || stack.length === 0) return [];
    const d = partData[name];
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = d.w;
    tempCanvas.height = d.h;
    const tempCtx = tempCanvas.getContext("2d");

    const serialized = [];
    for (const frame of stack) {
      let pixelsFrame = null;
      let layersFrame = null;
      let activeLayerIndex = 0;

      if (frame instanceof Uint8ClampedArray || Array.isArray(frame)) {
        pixelsFrame = frame;
        layersFrame = [{
          id: Date.now() + Math.random(),
          name: "Base Layer",
          visible: true,
          opacity: 1.0,
          pixels: frame
        }];
        activeLayerIndex = 0;
      } else {
        pixelsFrame = frame.pixels;
        layersFrame = frame.layers;
        activeLayerIndex = frame.activeLayerIndex;
      }

      // Put final composited pixels on temp canvas
      tempCtx.clearRect(0, 0, d.w, d.h);
      tempCtx.putImageData(new ImageData(new Uint8ClampedArray(pixelsFrame), d.w, d.h), 0, 0);
      const pixelsUrl = tempCanvas.toDataURL("image/png");

      // Put each layer's pixels on temp canvas to get its individual URL
      const serializedLayers = [];
      for (const ly of layersFrame) {
        tempCtx.clearRect(0, 0, d.w, d.h);
        tempCtx.putImageData(new ImageData(new Uint8ClampedArray(ly.pixels), d.w, d.h), 0, 0);
        const lyUrl = tempCanvas.toDataURL("image/png");
        serializedLayers.push({
          id: ly.id,
          name: ly.name,
          visible: ly.visible,
          opacity: ly.opacity,
          pixelsUrl: lyUrl
        });
      }

      serialized.push({
        pixelsUrl: pixelsUrl,
        layers: serializedLayers,
        activeLayerIndex: activeLayerIndex,
        globalActionId: frame.globalActionId
      });
    }
    return serialized;
  }

  async function deserializeStack(name, serialized) {
    if (!serialized || serialized.length === 0) return [];
    const d = partData[name];
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = d.w;
    tempCanvas.height = d.h;
    const tempCtx = tempCanvas.getContext("2d");

    const stack = [];
    for (const item of serialized) {
      if (typeof item === "string") {
        // Old simple format
        const img = new Image();
        img.src = item;
        await img.decode();
        
        tempCtx.clearRect(0, 0, d.w, d.h);
        tempCtx.drawImage(img, 0, 0);
        const id = tempCtx.getImageData(0, 0, d.w, d.h);
        const pixels = new Uint8ClampedArray(id.data);
        stack.push({
          pixels: pixels,
          layers: [{
            id: Date.now() + Math.random(),
            name: "Base Layer",
            visible: true,
            opacity: 1.0,
            pixels: pixels
          }],
          activeLayerIndex: 0
        });
      } else {
        // New layer-aware format
        const img = new Image();
        img.src = item.pixelsUrl;
        await img.decode();
        tempCtx.clearRect(0, 0, d.w, d.h);
        tempCtx.drawImage(img, 0, 0);
        const id = tempCtx.getImageData(0, 0, d.w, d.h);
        const pixels = new Uint8ClampedArray(id.data);

        const layers = [];
        for (const sLy of item.layers) {
          const lyImg = new Image();
          lyImg.src = sLy.pixelsUrl;
          await lyImg.decode();
          tempCtx.clearRect(0, 0, d.w, d.h);
          tempCtx.drawImage(lyImg, 0, 0);
          const lyId = tempCtx.getImageData(0, 0, d.w, d.h);
          layers.push({
            id: sLy.id,
            name: sLy.name,
            visible: sLy.visible,
            opacity: sLy.opacity,
            pixels: new Uint8ClampedArray(lyId.data)
          });
        }

        stack.push({
          pixels: pixels,
          layers: layers,
          activeLayerIndex: item.activeLayerIndex,
          globalActionId: item.globalActionId
        });
      }
    }
    return stack;
  }

  let isSavingLocalState = false;
  let savePending = false;

  async function saveLocalState() {
    if (isSavingLocalState) {
      savePending = true;
      return;
    }
    isSavingLocalState = true;
    savePending = false;

    try {
      if (!manifest || !partData) return;
      const skinName = ($("#skinName").value || "MySkin").trim();
      localStorage.setItem("expie_skin_name", skinName);

      if (previewHead && previewHead.value) {
        localStorage.setItem("expie_preview_head", previewHead.value);
      }
      if (previewEyes && previewEyes.value) {
        localStorage.setItem("expie_preview_eyes", previewEyes.value);
      }

      const editedParts = [];
      const tempCanvas = document.createElement("canvas");
      for (const name of Object.keys(partData)) {
        if (partData[name].edited) {
          editedParts.push(name);
          localStorage.setItem(`expie_part_${name}`, partData[name].canvas.toDataURL("image/png"));

          // Save current layer state
          if (partData[name].layers) {
            tempCanvas.width = partData[name].w;
            tempCanvas.height = partData[name].h;
            const tempCtx = tempCanvas.getContext("2d");
            const layersToSave = [];
            for (const ly of partData[name].layers) {
              tempCtx.clearRect(0, 0, partData[name].w, partData[name].h);
              tempCtx.putImageData(new ImageData(new Uint8ClampedArray(ly.pixels), partData[name].w, partData[name].h), 0, 0);
              layersToSave.push({
                id: ly.id,
                name: ly.name,
                visible: ly.visible,
                opacity: ly.opacity,
                pixelsUrl: tempCanvas.toDataURL("image/png")
              });
            }
            localStorage.setItem(`expie_layers_${name}`, JSON.stringify({
              layers: layersToSave,
              activeLayerIndex: partData[name].activeLayerIndex
            }));
          }

          // Serialize and save undo/redo stacks
          const undoSerialized = await serializeStack(name, undoStacks[name]);
          localStorage.setItem(`expie_undo_${name}`, JSON.stringify(undoSerialized));

          const redoSerialized = await serializeStack(name, redoStacks[name]);
          localStorage.setItem(`expie_redo_${name}`, JSON.stringify(redoSerialized));
        } else {
          localStorage.removeItem(`expie_part_${name}`);
          localStorage.removeItem(`expie_layers_${name}`);
          localStorage.removeItem(`expie_undo_${name}`);
          localStorage.removeItem(`expie_redo_${name}`);
        }
      }
      localStorage.setItem("expie_edited_parts", JSON.stringify(editedParts));
    } catch (e) {
      console.error("Local auto-save failed:", e);
    } finally {
      isSavingLocalState = false;
      if (savePending) {
        saveLocalState();
      }
    }
  }

  async function loadLocalState() {
    try {
      const savedSkinName = localStorage.getItem("expie_skin_name");
      if (savedSkinName) {
        $("#skinName").value = savedSkinName;
      }

      const savedHead = localStorage.getItem("expie_preview_head");
      const savedEyes = localStorage.getItem("expie_preview_eyes");
      if (savedHead && previewHead) previewHead.value = savedHead;
      if (savedEyes && previewEyes) previewEyes.value = savedEyes;

      const rawEditedParts = localStorage.getItem("expie_edited_parts");
      if (!rawEditedParts) return false;

      const editedParts = JSON.parse(rawEditedParts);
      if (editedParts.length === 0) return false;

      await Promise.all(editedParts.map(async (name) => {
        const dataUrl = localStorage.getItem(`expie_part_${name}`);
        if (!dataUrl || !partData[name]) return;

        const img = new Image();
        img.src = dataUrl;
        await img.decode();

        const d = partData[name];

        const ctx = d.canvas.getContext("2d");
        ctx.clearRect(0, 0, d.w, d.h);
        ctx.drawImage(img, 0, 0);

        const id = ctx.getImageData(0, 0, d.w, d.h);
        d.pixels = new Uint8ClampedArray(id.data);
        d.edited = true;

        // Restore layers from storage if they exist
        const rawLayers = localStorage.getItem(`expie_layers_${name}`);
        if (rawLayers) {
          const parsed = JSON.parse(rawLayers);
          const loadedLayers = [];
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = d.w;
          tempCanvas.height = d.h;
          const tempCtx = tempCanvas.getContext("2d");
          for (const sLy of parsed.layers) {
            const lyImg = new Image();
            lyImg.src = sLy.pixelsUrl;
            await lyImg.decode();
            tempCtx.clearRect(0, 0, d.w, d.h);
            tempCtx.drawImage(lyImg, 0, 0);
            const lyId = tempCtx.getImageData(0, 0, d.w, d.h);
            loadedLayers.push({
              id: sLy.id,
              name: sLy.name,
              visible: sLy.visible,
              opacity: sLy.opacity,
              pixels: new Uint8ClampedArray(lyId.data)
            });
          }
          d.layers = loadedLayers;
          d.activeLayerIndex = parsed.activeLayerIndex;
        } else {
          // Initialize fallback layers
          ensureLayers(name);
        }

        // Deserialize and load undo/redo stacks
        const rawUndo = localStorage.getItem(`expie_undo_${name}`);
        if (rawUndo) {
          undoStacks[name] = await deserializeStack(name, JSON.parse(rawUndo));
        }

        const rawRedo = localStorage.getItem(`expie_redo_${name}`);
        if (rawRedo) {
          redoStacks[name] = await deserializeStack(name, JSON.parse(rawRedo));
        }

        updatePartMetaUI(name);
        drawThumb(name);
      }));

      return true;
    } catch (e) {
      console.error("Local auto-load failed:", e);
      return false;
    }
  }

  // ─── Storage Metrics & Sizing ──────────────────────────────────────
  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function getExpieTotalStorageSize() {
    let totalBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("expie_")) {
        const val = localStorage.getItem(key);
        totalBytes += key.length + (val ? val.length : 0);
      }
    }
    return totalBytes;
  }

  function updateStorageIndicator() {
    const totalBytes = getExpieTotalStorageSize();
    const formattedTotal = formatBytes(totalBytes);
    const maxQuota = 5 * 1024 * 1024; // 5 MB
    const percentage = Math.min(100, (totalBytes / maxQuota) * 100);

    const storageText = $("#storageText");
    const storageBarFill = $("#storageBarFill");

    if (storageText) {
      storageText.textContent = `Storage: ${formattedTotal} / 5 MB (${percentage.toFixed(1)}%)`;
    }
    if (storageBarFill) {
      storageBarFill.style.width = `${percentage}%`;
      if (percentage > 80) {
        storageBarFill.style.background = "var(--danger)";
      } else {
        storageBarFill.style.background = "var(--ok)";
      }
    }
  }

  // ─── Saved Skins Library ───────────────────────────────────────────
  async function saveSkinToLibrary(skinName, silent = false) {
    if (!skinName || !skinName.trim()) {
      toast("Invalid skin name", "err");
      return;
    }
    const nameKey = skinName.trim();

    if (isSavingLocalState) {
      setTimeout(() => saveSkinToLibrary(skinName, silent), 200);
      return;
    }

    try {
      const partsDataUrls = {};
      for (const name of Object.keys(partData)) {
        if (partData[name].edited) {
          partsDataUrls[name] = partData[name].canvas.toDataURL("image/png");
        }
      }

      const skinData = {
        name: nameKey,
        updatedAt: Date.now(),
        parts: partsDataUrls,
        previewHead: previewHead ? previewHead.value : "",
        previewEyes: previewEyes ? previewEyes.value : ""
      };

      localStorage.setItem(`expie_lib_skin_${nameKey}`, JSON.stringify(skinData));

      let library = [];
      const rawLibrary = localStorage.getItem("expie_saved_skins_list");
      if (rawLibrary) {
        library = JSON.parse(rawLibrary);
      }

      const existing = library.find(item => item.name.toLowerCase() === nameKey.toLowerCase());
      if (existing) {
        existing.name = nameKey;
        existing.updatedAt = skinData.updatedAt;
      } else {
        library.push({ name: nameKey, updatedAt: skinData.updatedAt });
      }

      localStorage.setItem("expie_saved_skins_list", JSON.stringify(library));
      renderSkinsLibraryList();

      if (!silent) {
        toast(`Skin "${nameKey}" saved to library`, "ok");
      }
    } catch (e) {
      console.error("Failed to save skin to library:", e);
      toast("Failed to save skin", "err");
    }
  }

  async function loadSkinFromLibrary(skinName) {
    if (!confirm(`Are you sure you want to load skin "${skinName}"? Your current editor progress will be replaced.`)) {
      return;
    }

    try {
      const rawData = localStorage.getItem(`expie_lib_skin_${skinName}`);
      if (!rawData) {
        toast("Skin data not found", "err");
        return;
      }

      const skinData = JSON.parse(rawData);

      $("#skinName").value = skinData.name;
      localStorage.setItem("expie_skin_name", skinData.name);

      if (skinData.previewHead && previewHead) {
        previewHead.value = skinData.previewHead;
        localStorage.setItem("expie_preview_head", skinData.previewHead);
      }
      if (skinData.previewEyes && previewEyes) {
        previewEyes.value = skinData.previewEyes;
        localStorage.setItem("expie_preview_eyes", skinData.previewEyes);
      }

      for (const name of Object.keys(partData)) {
        const d = partData[name];
        d.pixels = new Uint8ClampedArray(d.base);
        updateCachedCanvas(name);
        d.edited = false;
        undoStacks[name] = [];
        redoStacks[name] = [];
        updatePartMetaUI(name);
        drawThumb(name);
        localStorage.removeItem(`expie_part_${name}`);
        localStorage.removeItem(`expie_undo_${name}`);
        localStorage.removeItem(`expie_redo_${name}`);
      }

      const partsToLoad = Object.keys(skinData.parts || {});
      const editedParts = [];
      
      await Promise.all(partsToLoad.map(async (name) => {
        const dataUrl = skinData.parts[name];
        if (!dataUrl || !partData[name]) return;

        const img = new Image();
        img.src = dataUrl;
        await img.decode();

        const d = partData[name];
        const ctx = d.canvas.getContext("2d");
        ctx.clearRect(0, 0, d.w, d.h);
        ctx.drawImage(img, 0, 0);

        const idImg = ctx.getImageData(0, 0, d.w, d.h);
        d.pixels = new Uint8ClampedArray(idImg.data);
        d.edited = true;
        editedParts.push(name);

        updatePartMetaUI(name);
        drawThumb(name);

        localStorage.setItem(`expie_part_${name}`, dataUrl);
      }));

      localStorage.setItem("expie_edited_parts", JSON.stringify(editedParts));

      if (currentPart) {
        drawPixels();
      }
      updateHistoryButtons();
      updatePreview();

      $("#settingsModal").hidden = true;
      toast(`Loaded skin "${skinData.name}"`, "ok");
    } catch (e) {
      console.error("Failed to load skin from library:", e);
      toast("Failed to load skin", "err");
    }
  }

  function deleteSkinFromLibrary(skinName) {
    if (!confirm(`Are you sure you want to permanently delete "${skinName}" from the library?`)) {
      return;
    }

    try {
      localStorage.removeItem(`expie_lib_skin_${skinName}`);

      let library = [];
      const rawLibrary = localStorage.getItem("expie_saved_skins_list");
      if (rawLibrary) {
        library = JSON.parse(rawLibrary);
      }

      library = library.filter(item => item.name.toLowerCase() !== skinName.toLowerCase());
      localStorage.setItem("expie_saved_skins_list", JSON.stringify(library));

      renderSkinsLibraryList();
      toast(`Skin "${skinName}" deleted`, "ok");
    } catch (e) {
      console.error("Failed to delete skin from library:", e);
      toast("Failed to delete skin", "err");
    }
  }

  function renderSkinsLibraryList() {
    const container = $("#skinsLibraryList");
    if (!container) return;

    container.innerHTML = "";

    let library = [];
    try {
      const rawLibrary = localStorage.getItem("expie_saved_skins_list");
      if (rawLibrary) {
        library = JSON.parse(rawLibrary);
      }
    } catch (e) {
      console.error("Error reading saved skins library list:", e);
    }

    if (library.length === 0) {
      container.innerHTML = `<div class="snapshots-empty">No saved skins in library yet.</div>`;
      updateStorageIndicator();
      return;
    }

    library.sort((a, b) => b.updatedAt - a.updatedAt);

    library.forEach(s => {
      const itemKey = `expie_lib_skin_${s.name}`;
      const itemVal = localStorage.getItem(itemKey);
      const itemSize = itemVal ? itemVal.length : 0;
      const sizeStr = formatBytes(itemSize);

      const dateStr = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date(s.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

      const item = document.createElement("div");
      item.className = "snapshot-item";
      item.innerHTML = `
        <div class="snapshot-info">
          <span class="snapshot-badge manual">Skin</span>
          <div class="snapshot-meta-text">
            <span class="snapshot-label" title="${s.name}">${s.name}</span>
            <span class="snapshot-time">${dateStr} · ${sizeStr}</span>
          </div>
        </div>
        <div class="snapshot-actions">
          <button class="btn btn-ghost btn-small load-skin-btn" data-name="${s.name}">Load</button>
          <button class="btn btn-ghost btn-small overwrite-skin-btn" data-name="${s.name}" title="Overwrite with current workspace">Save</button>
          <button class="btn btn-danger btn-small delete-skin-btn" data-name="${s.name}">×</button>
        </div>
      `;

      item.querySelector(".load-skin-btn").addEventListener("click", () => loadSkinFromLibrary(s.name));
      item.querySelector(".overwrite-skin-btn").addEventListener("click", () => saveSkinToLibrary(s.name));
      item.querySelector(".delete-skin-btn").addEventListener("click", () => deleteSkinFromLibrary(s.name));

      container.appendChild(item);
    });

    updateStorageIndicator();
  }

  // ─── Custom Swatches & Snapshots ───────────────────────────────────
  let snapshotIntervalId = null;

  function loadCustomSwatches() {
    const raw = localStorage.getItem("expie_custom_swatches");
    if (!raw) return;
    try {
      const customSwatches = JSON.parse(raw);
      for (const hex of customSwatches) {
        addSwatchToPalette(hex, false);
      }
    } catch (e) {
      console.error("Failed to load custom swatches:", e);
    }
  }

  function addSwatchToPalette(hex, save = true) {
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

    if (save) {
      try {
        const raw = localStorage.getItem("expie_custom_swatches");
        const customSwatches = raw ? JSON.parse(raw) : [];
        if (!customSwatches.includes(hex)) {
          customSwatches.push(hex);
          localStorage.setItem("expie_custom_swatches", JSON.stringify(customSwatches));
        }
      } catch (e) {
        console.error("Failed to save custom swatch:", e);
      }
    }
  }

  async function createSnapshot(isAuto = false, customName = "") {
    if (isSavingLocalState) {
      setTimeout(() => createSnapshot(isAuto, customName), 200);
      return;
    }

    try {
      const timestamp = Date.now();
      const id = "snap_" + timestamp;
      const skinName = ($("#skinName").value || "MySkin").trim();
      
      const partsDataUrls = {};
      const partsLayers = {};

      const tempCanvas = document.createElement("canvas");

      for (const name of Object.keys(partData)) {
        if (partData[name].edited) {
          partsDataUrls[name] = partData[name].canvas.toDataURL("image/png");

          if (partData[name].layers) {
            tempCanvas.width = partData[name].w;
            tempCanvas.height = partData[name].h;
            const tempCtx = tempCanvas.getContext("2d");
            const layersToSave = [];
            for (const ly of partData[name].layers) {
              tempCtx.clearRect(0, 0, partData[name].w, partData[name].h);
              tempCtx.putImageData(new ImageData(new Uint8ClampedArray(ly.pixels), partData[name].w, partData[name].h), 0, 0);
              layersToSave.push({
                id: ly.id,
                name: ly.name,
                visible: ly.visible,
                opacity: ly.opacity,
                pixelsUrl: tempCanvas.toDataURL("image/png")
              });
            }
            partsLayers[name] = {
              layers: layersToSave,
              activeLayerIndex: partData[name].activeLayerIndex
            };
          }
        }
      }

      const snapshotData = {
        skinName: skinName,
        parts: partsDataUrls,
        layers: partsLayers,
        previewHead: previewHead ? previewHead.value : "",
        previewEyes: previewEyes ? previewEyes.value : ""
      };

      localStorage.setItem(`expie_snapshot_data_${id}`, JSON.stringify(snapshotData));

      let snapshots = [];
      const rawSnapshots = localStorage.getItem("expie_snapshots_list");
      if (rawSnapshots) {
        snapshots = JSON.parse(rawSnapshots);
      }

      const label = customName || (isAuto ? "Auto Snapshot" : "Manual Snapshot");
      const newMeta = {
        id: id,
        timestamp: timestamp,
        label: label,
        isAuto: isAuto,
        skinName: skinName
      };

      snapshots.unshift(newMeta);

      while (snapshots.length > 10) {
        const removed = snapshots.pop();
        localStorage.removeItem(`expie_snapshot_data_${removed.id}`);
      }

      localStorage.setItem("expie_snapshots_list", JSON.stringify(snapshots));
      renderSnapshotsList();

      if (!isAuto) {
        toast("Snapshot saved successfully", "ok");
      }
    } catch (e) {
      console.error("Failed to create snapshot:", e);
      toast("Failed to save snapshot", "err");
    }
  }

  async function restoreSnapshot(id) {
    if (!confirm("Are you sure you want to restore this snapshot? Your current workspace will be replaced.")) {
      return;
    }

    try {
      const rawData = localStorage.getItem(`expie_snapshot_data_${id}`);
      if (!rawData) {
        toast("Snapshot data not found", "err");
        return;
      }

      const snapshotData = JSON.parse(rawData);

      if (snapshotData.skinName) {
        $("#skinName").value = snapshotData.skinName;
      }

      if (snapshotData.previewHead && previewHead) {
        previewHead.value = snapshotData.previewHead;
      }
      if (snapshotData.previewEyes && previewEyes) {
        previewEyes.value = snapshotData.previewEyes;
      }

      // Reset all parts first
      for (const name of Object.keys(partData)) {
        const d = partData[name];
        const p = manifest.parts.find(x => x.name === name);
        if (p) {
          d.w = p.width;
          d.h = p.height;
          d.canvas.width = p.width;
          d.canvas.height = p.height;
        }
        d.pixels = new Uint8ClampedArray(d.base);
        d.layers = null;
        ensureLayers(name);

        updateCachedCanvas(name);
        d.edited = false;
        undoStacks[name] = [];
        redoStacks[name] = [];
        updatePartMetaUI(name);
        drawThumb(name);
      }

      const partsToLoad = Object.keys(snapshotData.parts || {});
      await Promise.all(partsToLoad.map(async (name) => {
        const dataUrl = snapshotData.parts[name];
        if (!dataUrl || !partData[name]) return;

        const d = partData[name];

        const img = new Image();
        img.src = dataUrl;
        await img.decode();

        const ctx = d.canvas.getContext("2d");
        ctx.clearRect(0, 0, d.w, d.h);
        ctx.drawImage(img, 0, 0);

        const idImg = ctx.getImageData(0, 0, d.w, d.h);
        d.pixels = new Uint8ClampedArray(idImg.data);
        d.edited = true;

        // 2. Restore layers if they exist
        if (snapshotData.layers && snapshotData.layers[name]) {
          const parsed = snapshotData.layers[name];
          const loadedLayers = [];
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = d.w;
          tempCanvas.height = d.h;
          const tempCtx = tempCanvas.getContext("2d");
          for (const sLy of parsed.layers) {
            const lyImg = new Image();
            lyImg.src = sLy.pixelsUrl;
            await lyImg.decode();
            tempCtx.clearRect(0, 0, d.w, d.h);
            tempCtx.drawImage(lyImg, 0, 0);
            const lyId = tempCtx.getImageData(0, 0, d.w, d.h);
            loadedLayers.push({
              id: sLy.id,
              name: sLy.name,
              visible: sLy.visible,
              opacity: sLy.opacity,
              pixels: new Uint8ClampedArray(lyId.data)
            });
          }
          d.layers = loadedLayers;
          d.activeLayerIndex = parsed.activeLayerIndex;
        } else {
          ensureLayers(name);
        }

        updatePartMetaUI(name);
        drawThumb(name);
      }));

      if (currentPart) {
        renderCanvases();
        renderLayersUI();
        drawPixels();
      }
      updateHistoryButtons();
      updatePreview();
      
      $("#settingsModal").hidden = true;
      toast("Snapshot restored successfully", "ok");
    } catch (e) {
      console.error("Failed to restore snapshot:", e);
      toast("Failed to restore snapshot", "err");
    }
  }

  function deleteSnapshot(id) {
    try {
      localStorage.removeItem(`expie_snapshot_data_${id}`);

      let snapshots = [];
      const rawSnapshots = localStorage.getItem("expie_snapshots_list");
      if (rawSnapshots) {
        snapshots = JSON.parse(rawSnapshots);
      }

      snapshots = snapshots.filter(s => s.id !== id);
      localStorage.setItem("expie_snapshots_list", JSON.stringify(snapshots));

      renderSnapshotsList();
      toast("Snapshot deleted", "ok");
    } catch (e) {
      console.error("Failed to delete snapshot:", e);
      toast("Failed to delete snapshot", "err");
    }
  }

  function renderSnapshotsList() {
    const container = $("#snapshotsList");
    if (!container) return;

    container.innerHTML = "";

    let snapshots = [];
    try {
      const rawSnapshots = localStorage.getItem("expie_snapshots_list");
      if (rawSnapshots) {
        snapshots = JSON.parse(rawSnapshots);
      }
    } catch (e) {
      console.error("Error reading snapshots list:", e);
    }

    if (snapshots.length === 0) {
      container.innerHTML = `<div class="snapshots-empty">No saved snapshots yet.</div>`;
      updateStorageIndicator();
      return;
    }

    snapshots.forEach(s => {
      const itemKey = `expie_snapshot_data_${s.id}`;
      const itemVal = localStorage.getItem(itemKey);
      const itemSize = itemVal ? itemVal.length : 0;
      const sizeStr = formatBytes(itemSize);

      const dateStr = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date(s.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
      const badgeClass = s.isAuto ? "auto" : "manual";
      const badgeText = s.isAuto ? "Auto" : "Saved";

      const item = document.createElement("div");
      item.className = "snapshot-item";
      item.innerHTML = `
        <div class="snapshot-info">
          <span class="snapshot-badge ${badgeClass}">${badgeText}</span>
          <div class="snapshot-meta-text">
            <span class="snapshot-label" title="${s.label}">${s.label} (${s.skinName})</span>
            <span class="snapshot-time">${dateStr} · ${sizeStr}</span>
          </div>
        </div>
        <div class="snapshot-actions">
          <button class="btn btn-ghost btn-small restore-snap-btn" data-id="${s.id}">Restore</button>
          <button class="btn btn-danger btn-small delete-snap-btn" data-id="${s.id}" title="Delete snapshot">×</button>
        </div>
      `;

      item.querySelector(".restore-snap-btn").addEventListener("click", () => restoreSnapshot(s.id));
      item.querySelector(".delete-snap-btn").addEventListener("click", () => deleteSnapshot(s.id));

      container.appendChild(item);
    });

    updateStorageIndicator();
  }

  function startSnapshotTimer() {
    if (snapshotIntervalId) {
      clearInterval(snapshotIntervalId);
      snapshotIntervalId = null;
    }

    const autoEnabled = $("#autoSnapshotToggle").checked;
    localStorage.setItem("expie_auto_snapshot_enabled", autoEnabled ? "true" : "false");

    const intervalMinutes = parseInt($("#snapshotIntervalSelect").value, 10);
    localStorage.setItem("expie_snapshot_interval", intervalMinutes.toString());

    const intervalRow = $("#snapshotIntervalRow");
    if (intervalRow) {
      intervalRow.style.display = autoEnabled ? "flex" : "none";
    }

    if (!autoEnabled) return;

    const intervalMs = intervalMinutes * 60 * 1000;
    snapshotIntervalId = setInterval(() => {
      const hasEdited = Object.values(partData).some(d => d.edited);
      if (hasEdited) {
        createSnapshot(true, "Auto Snapshot");
      }
    }, intervalMs);
  }

  function resetEverything() {
    if (!confirm("CRITICAL WARNING: This will permanently delete ALL your local skin auto-saves, custom saved colors/swatches, undo/redo history, and ALL 10 time-based snapshots. There is NO UNDO. Are you absolutely sure?")) {
      return;
    }

    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("expie_")) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }

      $("#settingsModal").hidden = true;
      toast("Resetting application...", "ok");

      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (e) {
      console.error("Failed to reset everything:", e);
      toast("Error resetting data", "err");
    }
  }

  function exportBackup() {
    try {
      const backup = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("expie_")) {
          backup[key] = localStorage.getItem(key);
        }
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", url);
      downloadAnchor.setAttribute("download", `expie_maker_backup_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      URL.revokeObjectURL(url);
      toast("Backup exported successfully", "ok");
    } catch (err) {
      console.error("Export failed:", err);
      toast("Export failed: " + err.message, "err");
    }
  }

  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const backup = JSON.parse(e.target.result);
        
        let hasExpieKeys = false;
        for (const key in backup) {
          if (key.startsWith("expie_")) {
            hasExpieKeys = true;
            break;
          }
        }
        if (!hasExpieKeys) {
          toast("Invalid backup file: no editor data found.", "err");
          return;
        }

        if (confirm("Importing this backup will overwrite your current workspace, saved skins, snapshots, and custom swatches. Do you want to proceed?")) {
          // Clear existing expie keys
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("expie_")) {
              keysToRemove.push(key);
            }
          }
          for (const key of keysToRemove) {
            localStorage.removeItem(key);
          }

          // Write new keys
          for (const key in backup) {
            if (key.startsWith("expie_")) {
              localStorage.setItem(key, backup[key]);
            }
          }

          toast("Backup imported! Reloading editor...", "ok");
          setTimeout(() => {
            window.location.reload();
          }, 1200);
        }
      } catch (err) {
        console.error("Import failed:", err);
        toast("Failed to parse backup file", "err");
      }
    };
    reader.readAsText(file);
  }


  function applyTheme(theme) {
    const el = $("#themeSelect");
    if (el) el.value = theme;

    document.body.classList.remove(
      "theme-cherry-blossom",
      "theme-cyberpunk",
      "theme-warm-oak",
      "theme-terminal"
    );

    if (theme !== "obsidian") {
      document.body.classList.add("theme-" + theme);
    }

    if (currentPart && partData[currentPart]) {
      const d = partData[currentPart];
      drawBg(d.w, d.h, editCanvas.width, editCanvas.height);
    }
  }


  // ─── Load manifest + base PNGs ──────────────────────────────────────
  async function init() {
    const resManifest = await fetch("assets/manifest.json");
    if (!resManifest.ok) throw new Error(`Failed to load manifest.json (status ${resManifest.status})`);
    manifest = await resManifest.json();

    // Load all base PNGs in parallel
    await Promise.all(manifest.parts.map(async (p) => {
      const img = new Image();
      img.src = `assets/base-skin/${p.folder}/${p.name}.png`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = p.width;
      c.height = p.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, p.width, p.height);
      const baseBbox = calculateBoundingBox(id.data, p.width, p.height);
      partData[p.name] = {
        w: p.width, h: p.height,
        pixels: new Uint8ClampedArray(id.data),
        base: new Uint8ClampedArray(id.data), // immutable copy
        edited: false,
        canvas: c,
        baseBbox: baseBbox,
        bbox: baseBbox
      };
      ensureLayers(p.name);
      undoStacks[p.name] = [];
      redoStacks[p.name] = [];
    }));

    buildPartsList();
    buildPalette();
    loadCustomSwatches();
    buildPreviewSelects();

    const loaded = await loadLocalState();

    // Load auto-snapshot settings
    const autoEnabled = localStorage.getItem("expie_auto_snapshot_enabled") !== "false";
    $("#autoSnapshotToggle").checked = autoEnabled;

    const savedInterval = localStorage.getItem("expie_snapshot_interval") || "3";
    $("#snapshotIntervalSelect").value = savedInterval;

    // Load studio theme settings
    const savedTheme = localStorage.getItem("expie_theme") || "obsidian";
    applyTheme(savedTheme);

    startSnapshotTimer();



    selectPart(manifest.parts[0].name);
    setTool("pencil");
    bindEvents();
    startPreviewLoop();
    updateHistoryButtons();

    if (loaded) {
      toast("Restored your progress from auto-save", "ok");
    }
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
        <canvas class="part-thumb" width="28" height="28" data-name="${p.name}"></canvas>
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
    ctx.clearRect(0, 0, 28, 28);
    const scale = Math.min(24 / d.w, 24 / d.h);
    const x = (28 - d.w * scale) / 2;
    const y = (28 - d.h * scale) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(d.canvas, x, y, d.w * scale, d.h * scale);
    if (name === currentPart && typeof updateActiveColors === "function") {
      updateActiveColors();
    }
  }

  function updatePartMetaUI(name) {
    const item = partsListEl.querySelector(`.part-item[data-name="${name}"]`);
    if (!item) return;
    const dims = item.querySelector(".part-dims");
    const editedEl = dims.querySelector(".part-edited");
    if (partData[name].edited) {
      if (!editedEl) {
        dims.insertAdjacentHTML("beforeend", '<span class="part-edited"> · edited</span>');
      }
    } else {
      if (editedEl) {
        editedEl.remove();
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
    


    updateHistoryButtons();
    renderCanvases();
    if (typeof updateActiveColors === "function") {
      updateActiveColors();
    }
    ensureLayers(name);
    if (typeof renderLayersUI === "function") {
      renderLayersUI();
    }
  }

  // ─── Render editor canvases ────────────────────────────────────────
  function renderCanvases() {
    const d = partData[currentPart];
    const w = d.w * zoom, h = d.h * zoom;
    for (const c of [editCanvas, bgCanvas, gridCanvas, referenceCanvas]) {
      if (c) {
        c.width = w; c.height = h;
        c.style.width = w + "px"; c.style.height = h + "px";
      }
    }
    drawBg(d.w, d.h, w, h);
    drawPixels();
    drawGrid(d.w, d.h, w, h);
    drawReferenceOverlay();
  }

  function updateOverlayFilters() {
    if (!referenceCanvas) return;
    let filterStr = "";
    if (overlayFilterInvert) filterStr += " invert(1)";
    if (overlayFilterGrayscale) filterStr += " grayscale(1)";
    referenceCanvas.style.filter = filterStr;
  }

  function drawReferenceOverlay() {
    if (!referenceCanvas) return;
    const ctx = referenceCanvas.getContext("2d");
    ctx.clearRect(0, 0, referenceCanvas.width, referenceCanvas.height);
    if (!referenceImage) return;

    ctx.imageSmoothingEnabled = false;
    ctx.save();

    const canvasW = referenceCanvas.width;
    const canvasH = referenceCanvas.height;
    const imgW = referenceImage.width;
    const imgH = referenceImage.height;

    let drawW = canvasW;
    let drawH = canvasH;
    let startX = 0;
    let startY = 0;

    if (overlayFitMode === "stretch") {
      drawW = canvasW;
      drawH = canvasH;
    } else if (overlayFitMode === "contain") {
      const ratio = Math.min(canvasW / imgW, canvasH / imgH);
      drawW = imgW * ratio;
      drawH = imgH * ratio;
      startX = (canvasW - drawW) / 2;
      startY = (canvasH - drawH) / 2;
    } else if (overlayFitMode === "cover") {
      const ratio = Math.max(canvasW / imgW, canvasH / imgH);
      drawW = imgW * ratio;
      drawH = imgH * ratio;
      startX = (canvasW - drawW) / 2;
      startY = (canvasH - drawH) / 2;
    } else if (overlayFitMode === "original") {
      drawW = imgW * zoom;
      drawH = imgH * zoom;
      startX = (canvasW - drawW) / 2;
      startY = (canvasH - drawH) / 2;
    }

    const tx = overlayOffsetX * zoom;
    const ty = overlayOffsetY * zoom;

    const centerX = startX + drawW / 2;
    const centerY = startY + drawH / 2;

    ctx.translate(centerX + tx, centerY + ty);
    ctx.scale(overlayScale, overlayScale);

    if (overlayFilterTint) {
      ctx.drawImage(referenceImage, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = overlayFilterTintColor;
      ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.drawImage(referenceImage, -drawW / 2, -drawH / 2, drawW, drawH);
    }

    ctx.restore();
  }

  function drawBg(pw, ph, w, h) {
    bgCtx.clearRect(0, 0, w, h);
    const s = zoom;
    const style = getComputedStyle(document.body);
    const c1 = style.getPropertyValue("--checker-1").trim() || "#2e333f";
    const c2 = style.getPropertyValue("--checker-2").trim() || "#262b38";
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        bgCtx.fillStyle = (x + y) % 2 === 0 ? c1 : c2;
        bgCtx.fillRect(x * s, y * s, s, s);
      }
    }
  }

  function drawPixels() {
    const d = partData[currentPart];
    compositeLayers(currentPart);
    updateCachedCanvas(currentPart);
    editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
    editCtx.imageSmoothingEnabled = false;
    editCtx.drawImage(d.canvas, 0, 0, editCanvas.width, editCanvas.height);
    if (typeof updateLayerThumbs === "function") {
      updateLayerThumbs();
    }
  }

  function drawGrid(pw, ph, w, h) {
    gridCtx.clearRect(0, 0, w, h);
    if (showGrid && zoom >= 6) {
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

    if (mirrorToggle && mirrorToggle.checked) {
      gridCtx.save();
      gridCtx.strokeStyle = "rgba(59, 130, 246, 0.85)"; // High contrast electric blue
      gridCtx.lineWidth = 2;
      gridCtx.setLineDash([6, 4]);
      const centerX = (pw / 2) * zoom;
      gridCtx.beginPath();
      gridCtx.moveTo(centerX, 0);
      gridCtx.lineTo(centerX, h);
      gridCtx.stroke();
      gridCtx.restore();
    }
  }

  // ─── Pixel operations ──────────────────────────────────────────────
  function pixelAt(name, x, y) {
    const d = partData[name]; const i = (y * d.w + x) * 4;
    return { r: d.pixels[i], g: d.pixels[i + 1], b: d.pixels[i + 2], a: d.pixels[i + 3] };
  }

  function pixelAtLayer(name, layerIndex, x, y) {
    const d = partData[name];
    ensureLayers(name);
    const px = d.layers[layerIndex].pixels;
    const i = (y * d.w + x) * 4;
    return { r: px[i], g: px[i + 1], b: px[i + 2], a: px[i + 3] };
  }

  function setPixel(name, x, y, r, g, b, a) {
    const d = partData[name];
    ensureLayers(name);
    const px = d.layers[d.activeLayerIndex].pixels;
    const i = (y * d.w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }

  function blendPixel(name, x, y, r, g, b, a) {
    const d = partData[name];
    ensureLayers(name);
    const px = d.layers[d.activeLayerIndex].pixels;
    const i = (y * d.w + x) * 4;
    const bgR = px[i];
    const bgG = px[i + 1];
    const bgB = px[i + 2];
    const bgA = px[i + 3];

    if (bgA === 0) {
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = a;
      return;
    }

    const alphaFg = a / 255;
    const alphaBg = bgA / 255;

    const alphaOut = alphaFg + alphaBg * (1 - alphaFg);
    if (alphaOut === 0) {
      px[i] = 0;
      px[i + 1] = 0;
      px[i + 2] = 0;
      px[i + 3] = 0;
      return;
    }

    const outR = Math.round((r * alphaFg + bgR * alphaBg * (1 - alphaFg)) / alphaOut);
    const outG = Math.round((g * alphaFg + bgG * alphaBg * (1 - alphaFg)) / alphaOut);
    const outB = Math.round((b * alphaFg + bgB * alphaBg * (1 - alphaFg)) / alphaOut);
    const outA = Math.round(alphaOut * 255);

    px[i] = outR;
    px[i + 1] = outG;
    px[i + 2] = outB;
    px[i + 3] = outA;
  }

  function erasePixel(name, x, y, a) {
    const d = partData[name];
    ensureLayers(name);
    const px = d.layers[d.activeLayerIndex].pixels;
    const i = (y * d.w + x) * 4;
    const bgA = px[i + 3];
    if (bgA === 0) return;

    const alphaErase = a / 255;
    const newA = Math.round(bgA * (1 - alphaErase));
    
    if (newA === 0) {
      px[i] = 0;
      px[i + 1] = 0;
      px[i + 2] = 0;
      px[i + 3] = 0;
    } else {
      px[i + 3] = newA;
    }
  }

  function cloneLayers(layers) {
    return layers.map(ly => ({
      id: ly.id,
      name: ly.name,
      visible: ly.visible,
      opacity: ly.opacity,
      pixels: new Uint8ClampedArray(ly.pixels)
    }));
  }

  function pushUndo(name, globalActionId = null) {
    const d = partData[name];
    ensureLayers(name);
    undoStacks[name].push({
      pixels: new Uint8ClampedArray(d.pixels),
      layers: cloneLayers(d.layers),
      activeLayerIndex: d.activeLayerIndex,
      globalActionId: globalActionId
    });
    if (undoStacks[name].length > MAX_UNDO) undoStacks[name].shift();
    redoStacks[name] = [];
    updateHistoryButtons();
  }

  function undo() {
    if (!currentPart) return;
    const stack = undoStacks[currentPart];
    if (stack.length === 0) return;
    
    const d = partData[currentPart];
    const peek = stack[stack.length - 1];
    const actionId = peek.globalActionId;

    if (actionId) {
      // Grouped/Global undo action across all parts
      for (const name of Object.keys(partData)) {
        const pStack = undoStacks[name];
        if (pStack.length > 0 && pStack[pStack.length - 1].globalActionId === actionId) {
          const partState = pStack.pop();
          const partD = partData[name];

          redoStacks[name].push({
            pixels: new Uint8ClampedArray(partD.pixels),
            layers: cloneLayers(partD.layers),
            activeLayerIndex: partD.activeLayerIndex,
            globalActionId: actionId
          });

          partD.pixels = partState.pixels;
          partD.layers = partState.layers;
          partD.activeLayerIndex = partState.activeLayerIndex;
          updateCachedCanvas(name);
          partD.edited = !arraysEqual(partD.pixels, partD.base);
          updatePartMetaUI(name);
          drawThumb(name);
        }
      }
    } else {
      // Normal single part undo
      redoStacks[currentPart].push({
        pixels: new Uint8ClampedArray(d.pixels),
        layers: cloneLayers(d.layers),
        activeLayerIndex: d.activeLayerIndex
      });
      const state = stack.pop();
      d.pixels = state.pixels;
      d.layers = state.layers;
      d.activeLayerIndex = state.activeLayerIndex;
      updateCachedCanvas(currentPart);
      d.edited = !arraysEqual(d.pixels, d.base);
      updatePartMetaUI(currentPart);
      drawThumb(currentPart);
    }

    updateHistoryButtons();
    renderLayersUI();
    drawPixels();
    updatePreview();
    saveLocalState();
  }

  function redo() {
    if (!currentPart) return;
    const stack = redoStacks[currentPart];
    if (stack.length === 0) return;
    
    const d = partData[currentPart];
    const peek = stack[stack.length - 1];
    const actionId = peek.globalActionId;

    if (actionId) {
      // Grouped/Global redo action across all parts
      for (const name of Object.keys(partData)) {
        const rStack = redoStacks[name];
        if (rStack.length > 0 && rStack[rStack.length - 1].globalActionId === actionId) {
          const partState = rStack.pop();
          const partD = partData[name];

          undoStacks[name].push({
            pixels: new Uint8ClampedArray(partD.pixels),
            layers: cloneLayers(partD.layers),
            activeLayerIndex: partD.activeLayerIndex,
            globalActionId: actionId
          });

          partD.pixels = partState.pixels;
          partD.layers = partState.layers;
          partD.activeLayerIndex = partState.activeLayerIndex;
          updateCachedCanvas(name);
          partD.edited = !arraysEqual(partD.pixels, partD.base);
          updatePartMetaUI(name);
          drawThumb(name);
        }
      }
    } else {
      // Normal single part redo
      undoStacks[currentPart].push({
        pixels: new Uint8ClampedArray(d.pixels),
        layers: cloneLayers(d.layers),
        activeLayerIndex: d.activeLayerIndex
      });
      const state = stack.pop();
      d.pixels = state.pixels;
      d.layers = state.layers;
      d.activeLayerIndex = state.activeLayerIndex;
      updateCachedCanvas(currentPart);
      d.edited = !arraysEqual(d.pixels, d.base);
      updatePartMetaUI(currentPart);
      drawThumb(currentPart);
    }

    updateHistoryButtons();
    renderLayersUI();
    drawPixels();
    updatePreview();
    saveLocalState();
  }

  function flipHorizontal() {
    if (!currentPart) return;
    const d = partData[currentPart];
    pushUndo(currentPart);
    
    const w = d.w, h = d.h;
    ensureLayers(currentPart);
    for (const ly of d.layers) {
      const newLyPixels = new Uint8ClampedArray(ly.pixels.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const srcIdx = (y * w + x) * 4;
          const destIdx = (y * w + (w - 1 - x)) * 4;
          newLyPixels[destIdx] = ly.pixels[srcIdx];
          newLyPixels[destIdx + 1] = ly.pixels[srcIdx + 1];
          newLyPixels[destIdx + 2] = ly.pixels[srcIdx + 2];
          newLyPixels[destIdx + 3] = ly.pixels[srcIdx + 3];
        }
      }
      ly.pixels = newLyPixels;
    }
    
    compositeLayers(currentPart);
    updateCachedCanvas(currentPart);
    d.edited = !arraysEqual(d.pixels, d.base);
    updatePartMetaUI(currentPart);
    updateHistoryButtons();
    drawPixels();
    drawThumb(currentPart);
    updatePreview();
    saveLocalState();
  }

  function flipVertical() {
    if (!currentPart) return;
    const d = partData[currentPart];
    pushUndo(currentPart);
    
    const w = d.w, h = d.h;
    ensureLayers(currentPart);
    for (const ly of d.layers) {
      const newLyPixels = new Uint8ClampedArray(ly.pixels.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const srcIdx = (y * w + x) * 4;
          const destIdx = ((h - 1 - y) * w + x) * 4;
          newLyPixels[destIdx] = ly.pixels[srcIdx];
          newLyPixels[destIdx + 1] = ly.pixels[srcIdx + 1];
          newLyPixels[destIdx + 2] = ly.pixels[srcIdx + 2];
          newLyPixels[destIdx + 3] = ly.pixels[srcIdx + 3];
        }
      }
      ly.pixels = newLyPixels;
    }
    
    compositeLayers(currentPart);
    updateCachedCanvas(currentPart);
    d.edited = !arraysEqual(d.pixels, d.base);
    updatePartMetaUI(currentPart);
    updateHistoryButtons();
    drawPixels();
    drawThumb(currentPart);
    updatePreview();
    saveLocalState();
  }

  function floodFill(name, sx, sy, tr, tg, tb, ta) {
    const d = partData[name];
    ensureLayers(name);
    const px = d.layers[d.activeLayerIndex].pixels;
    const si = (sy * d.w + sx) * 4;
    const sr = px[si], sg = px[si + 1], sb = px[si + 2], sa = px[si + 3];
    if (sr === tr && sg === tg && sb === tb && sa === ta) return;

    const visited = new Uint8Array(d.w * d.h);
    const stack = [[sx, sy]];
    visited[sy * d.w + sx] = 1;

    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      blendPixel(name, cx, cy, tr, tg, tb, ta);

      const neighbors = [
        [cx - 1, cy], [cx + 1, cy],
        [cx, cy - 1], [cx, cy + 1]
      ];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < d.w && ny >= 0 && ny < d.h) {
          const idx = ny * d.w + nx;
          if (!visited[idx]) {
            const nci = idx * 4;
            if (colorsMatch(px, nci, sr, sg, sb, sa)) {
              visited[idx] = 1;
              stack.push([nx, ny]);
            }
          }
        }
      }
    }
  }

  // ─── Canvas Color Extractor ────────────────────────────────────────
  function updateActiveColors() {
    const activeList = $("#activeColors");
    if (!activeList || !currentPart) return;
    const d = partData[currentPart];
    if (!d || !d.pixels) return;

    // Scan unique colors where alpha is non-zero
    const colorsSet = new Set();
    const px = d.pixels;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a > 0) {
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const hex = rgbaToHex(r, g, b).toUpperCase();
        colorsSet.add(hex);
      }
    }

    const uniqueColors = Array.from(colorsSet).sort();
    activeList.innerHTML = "";
    
    if (uniqueColors.length === 0) {
      activeList.innerHTML = `<span style="font-size: 10px; color: var(--muted); grid-column: span 8; text-align: center; padding: 4px 0;">None</span>`;
      return;
    }

    const currentHex = rgbaToHex(color.r, color.g, color.b).toUpperCase();

    for (const hex of uniqueColors) {
      const s = document.createElement("div");
      s.className = "swatch";
      s.style.setProperty("--c", hex);
      s.innerHTML = `<span class="fill" style="background:${hex}"></span>`;
      if (hex === currentHex) {
        s.classList.add("active");
      }
      s.title = hex;
      s.addEventListener("click", () => {
        const c = hexToRgb(hex);
        color.r = c.r; color.g = c.g; color.b = c.b;
        syncColorUI();
      });
      activeList.appendChild(s);
    }
  }

  function outlineSprite(type) {
    let anyApplied = false;
    const globalActionId = "outline_" + Date.now();

    // 1. Gather all the marked pixels for each part first
    const partMarkedPixels = {};
    for (const name of Object.keys(partData)) {
      const d = partData[name];
      if (!d) continue;
      ensureLayers(name);

      const w = d.w;
      const h = d.h;
      const px = d.layers[d.activeLayerIndex].pixels;
      const marked = [];

      if (type === "outer") {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            if (px[idx + 3] === 0) { // empty pixel on this layer
              const neighbors = [
                [x - 1, y], [x + 1, y],
                [x, y - 1], [x, y + 1]
              ];
              let hasActiveNeighbor = false;
              for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                  const nIdx = (ny * w + nx) * 4;
                  if (px[nIdx + 3] > 0) {
                    hasActiveNeighbor = true;
                    break;
                  }
                }
              }
              if (hasActiveNeighbor) {
                marked.push({ x, y });
              }
            }
          }
        }
      } else if (type === "inner") {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            if (px[idx + 3] > 0) { // non-empty pixel on this layer
              const neighbors = [
                [x - 1, y], [x + 1, y],
                [x, y - 1], [x, y + 1]
              ];
              let isEdge = false;
              for (const [nx, ny] of neighbors) {
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
                  isEdge = true;
                  break;
                } else {
                  const nIdx = (ny * w + nx) * 4;
                  if (px[nIdx + 3] === 0) {
                    isEdge = true;
                    break;
                  }
                }
              }
              if (isEdge) {
                marked.push({ x, y });
              }
            }
          }
        }
      }

      if (marked.length > 0) {
        partMarkedPixels[name] = marked;
        anyApplied = true;
      }
    }

    // 2. If any part actually has pixels to modify, push undo states and apply outline
    if (anyApplied) {
      // Push undo state to ALL parts first (so they all have the same globalActionId)
      for (const name of Object.keys(partData)) {
        const d = partData[name];
        if (!d) continue;
        pushUndo(name, globalActionId);
      }

      // Now apply outline to the modified parts
      for (const name of Object.keys(partMarkedPixels)) {
        const d = partData[name];
        const marked = partMarkedPixels[name];
        
        const drawColor = { r: color.r, g: color.g, b: color.b, a: color.a };
        const brushOp = parseInt($("#brushOpacity").value, 10) / 100;
        const finalAlpha = Math.round(drawColor.a * brushOp);

        for (const pt of marked) {
          setPixel(name, pt.x, pt.y, drawColor.r, drawColor.g, drawColor.b, finalAlpha);
        }

        compositeLayers(name);
        d.edited = !arraysEqual(d.pixels, d.base);
        updatePartMetaUI(name);
        updateHistoryButtons();
        updateCachedCanvas(name);
        drawThumb(name);
      }

      drawPixels();
      updatePreview();
      saveLocalState();
      toast(`Global ${type === "outer" ? "Outer" : "Inner"} outline applied to all parts!`);
    } else {
      toast("No outlines needed on any part.", "info");
    }
  }

  // ─── Burn / Dodge Auto Shading ─────────────────────────────────────
  function applyShading(x, y) {
    const d = partData[currentPart];
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
    ensureLayers(currentPart);
    const target = pixelAtLayer(currentPart, d.activeLayerIndex, x, y);
    if (target.a === 0) return;

    const modeEl = document.querySelector('input[name="shadingMode"]:checked');
    const mode = modeEl ? modeEl.value : "dodge";
    const exposure = parseInt($("#shadingIntensity").value, 10) / 100;
    const brushOp = parseInt($("#brushOpacity").value, 10) / 100;
    const amount = exposure * brushOp;

    const hsl = rgbToHsl(target.r, target.g, target.b);
    if (mode === "dodge") {
      hsl.l = Math.min(1.0, hsl.l + amount);
    } else {
      hsl.l = Math.max(0.0, hsl.l - amount);
    }

    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    setPixel(currentPart, x, y, rgb.r, rgb.g, rgb.b, target.a);
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

    const brushOp = parseInt($("#brushOpacity").value, 10) / 100;
    const mirrorActive = mirrorToggle && mirrorToggle.checked;
    const mirroredX = d.w - 1 - px;

    if (tool === "pencil") {
      const combinedAlpha = Math.round(color.a * brushOp);
      blendPixel(currentPart, px, py, color.r, color.g, color.b, combinedAlpha);
      if (mirrorActive && mirroredX !== px && mirroredX >= 0 && mirroredX < d.w) {
        blendPixel(currentPart, mirroredX, py, color.r, color.g, color.b, combinedAlpha);
      }
    } else if (tool === "eraser") {
      const eraseAlpha = Math.round(255 * brushOp);
      erasePixel(currentPart, px, py, eraseAlpha);
      if (mirrorActive && mirroredX !== px && mirroredX >= 0 && mirroredX < d.w) {
        erasePixel(currentPart, mirroredX, py, eraseAlpha);
      }
    } else if (tool === "fill") {
      const combinedAlpha = Math.round(color.a * brushOp);
      floodFill(currentPart, px, py, color.r, color.g, color.b, combinedAlpha);
      if (mirrorActive && mirroredX !== px && mirroredX >= 0 && mirroredX < d.w) {
        floodFill(currentPart, mirroredX, py, color.r, color.g, color.b, combinedAlpha);
      }
    } else if (tool === "replace") {
      replaceColor(px, py);
    } else if (tool === "shading") {
      applyShading(px, py);
      if (mirrorActive && mirroredX !== px && mirroredX >= 0 && mirroredX < d.w) {
        applyShading(mirroredX, py);
      }
    } else if (tool === "picker") {
      const c = pixelAt(currentPart, px, py);
      color.r = c.r; color.g = c.g; color.b = c.b; color.a = 255;
      syncColorUI();
      setTool("pencil");
    }
  }

  function replaceColor(sx, sy) {
    const d = partData[currentPart];
    if (sx < 0 || sy < 0 || sx >= d.w || sy >= d.h) return;
    ensureLayers(currentPart);
    const targetPixel = pixelAtLayer(currentPart, d.activeLayerIndex, sx, sy);
    if (targetPixel.a === 0) return; // skip transparent

    const tolerance = parseInt($("#replaceTolerance").value, 10);
    const maxDist = tolerance * 4.42;
    const preserveShading = $("#replacePreserveShading").checked;

    const C_old = targetPixel;
    const C_new = { r: color.r, g: color.g, b: color.b, a: color.a };

    const HSL_old = rgbToHsl(C_old.r, C_old.g, C_old.b);
    const HSL_new = rgbToHsl(C_new.r, C_new.g, C_new.b);

    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const P = pixelAtLayer(currentPart, d.activeLayerIndex, x, y);
        if (P.a === 0) continue; // skip transparent

        const dist = Math.sqrt(
          Math.pow(P.r - C_old.r, 2) +
          Math.pow(P.g - C_old.g, 2) +
          Math.pow(P.b - C_old.b, 2)
        );

        if (dist <= maxDist) {
          if (preserveShading) {
            const HSL_P = rgbToHsl(P.r, P.g, P.b);
            const deltaL = HSL_P.l - HSL_old.l;
            const L_final = Math.max(0, Math.min(1, HSL_new.l + deltaL));
            const rgbFinal = hslToRgb(HSL_new.h, HSL_new.s, L_final);
            setPixel(currentPart, x, y, rgbFinal.r, rgbFinal.g, rgbFinal.b, P.a);
          } else {
            setPixel(currentPart, x, y, C_new.r, C_new.g, C_new.b, P.a);
          }
        }
      }
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

  let isDraggingOverlay = false;
  let dragStartMouse = { x: 0, y: 0 };
  let dragStartOffset = { x: 0, y: 0 };

  function onPointerDown(e) {
    if (referenceImage && (e.button === 2 || (e.button === 0 && e.altKey))) {
      isDraggingOverlay = true;
      dragStartMouse = { x: e.clientX, y: e.clientY };
      dragStartOffset = { x: overlayOffsetX, y: overlayOffsetY };
      editCanvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;
    isDrawing = true;
    const { x, y } = canvasCoords(e);
    pushUndo(currentPart);
    applyTool(x, y);
    lastPx = { x, y };
    drawPixels();
    partData[currentPart].edited = true;
    updatePartMetaUI(currentPart);
    editCanvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (isDraggingOverlay) {
      const dx = e.clientX - dragStartMouse.x;
      const dy = e.clientY - dragStartMouse.y;
      overlayOffsetX = dragStartOffset.x + (dx / zoom);
      overlayOffsetY = dragStartOffset.y + (dy / zoom);

      const offsetXInput = $("#overlayOffsetXInput");
      const offsetYInput = $("#overlayOffsetYInput");
      if (offsetXInput) offsetXInput.value = Number(overlayOffsetX.toFixed(1));
      if (offsetYInput) offsetYInput.value = Number(overlayOffsetY.toFixed(1));

      renderCanvases();
      e.preventDefault();
      return;
    }

    const { x, y } = canvasCoords(e);
    const d = partData[currentPart];
    if (x >= 0 && y >= 0 && x < d.w && y < d.h) {
      $("#cursorPos").textContent = `(${x}, ${y})`;
    } else {
      $("#cursorPos").textContent = "";
    }
    if (!isDrawing) return;
    if (tool === "fill" || tool === "picker" || tool === "replace") return;
    if (lastPx && lastPx.x === x && lastPx.y === y) return; // skip if same pixel coordinates
    if (lastPx) plotLine(lastPx.x, lastPx.y, x, y); else applyTool(x, y);
    lastPx = { x, y };
    drawPixels();
  }

  function onPointerUp(e) {
    if (isDraggingOverlay) {
      isDraggingOverlay = false;
      editCanvas.releasePointerCapture(e.pointerId);
      return;
    }

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
    updateActiveSwatch();
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
      t === "replace" ? "crosshair" :
      t === "shading" ? "crosshair" :
      t === "picker" ? "copy" : "default";

    const replaceSettings = $("#replaceSettings");
    if (replaceSettings) {
      replaceSettings.style.display = t === "replace" ? "block" : "none";
    }

    const shadingSettings = $("#shadingSettings");
    if (shadingSettings) {
      shadingSettings.style.display = t === "shading" ? "block" : "none";
    }
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
  // ─── Preview Rendering and Skeletal Animation ──────────────────────────
  let animFrameId = null;
  function startPreviewLoop() {
    function loop(timestamp) {
      drawPreview(timestamp);
      animFrameId = requestAnimationFrame(loop);
    }
    animFrameId = requestAnimationFrame(loop);
  }

  function drawFacePreview() {
    const hName = previewHead.value;
    const eName = previewEyes.value;
    const hd = partData[hName];
    const ed = partData[eName];
    if (!hd || !ed) return;
    const s = 6;
    const w = hd.w * s, h = hd.h * s;
    previewCanvas.width = w;
    previewCanvas.height = h;
    previewCanvas.style.width = w + "px";
    previewCanvas.style.height = h + "px";
    previewCtx.clearRect(0, 0, w, h);
    previewCtx.imageSmoothingEnabled = false;

    previewCtx.drawImage(hd.canvas, 0, 0, w, h);

    const ex = Math.round(((hd.w - ed.w) / 2) * s);
    const ey = Math.round(((hd.h - ed.h) / 2 - 1) * s);
    previewCtx.drawImage(ed.canvas, ex, ey, ed.w * s, ed.h * s);
  }



  function calculateBoundingBox(pixels, w, h) {
    let minX = w, maxX = -1, minY = h, maxY = -1;
    let hasPixels = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (w * y + x) << 2;
        if (pixels[idx + 3] > 0) {
          hasPixels = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!hasPixels) {
      return { minX: 0, maxX: w - 1, minY: 0, maxY: h - 1, hasPixels: false };
    }
    return { minX, maxX, minY, maxY, hasPixels: true };
  }

  function drawPreview(timestamp) {
    drawFacePreview();
  }

  function updatePreview() {
    drawPreview(performance.now());
    saveLocalState();
  }

  // ─── Import / Export ────────────────────────────────────────────────
  async function importPNG(name, file, skipPreviewUpdate) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const d = partData[name];
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = d.w;
    tempCanvas.height = d.h;
    const ctx = tempCanvas.getContext("2d");
    ctx.drawImage(img, 0, 0, d.w, d.h);
    const id = ctx.getImageData(0, 0, d.w, d.h);
    pushUndo(name);
    d.pixels = new Uint8ClampedArray(id.data);
    d.layers = [{
      id: Date.now() + Math.random(),
      name: "Base Layer",
      visible: true,
      opacity: 1.0,
      pixels: new Uint8ClampedArray(d.pixels)
    }];
    d.activeLayerIndex = 0;
    updateCachedCanvas(name);
    d.edited = true;
    URL.revokeObjectURL(url);
    updatePartMetaUI(name);
    drawThumb(name);
    if (name === currentPart) {
      renderLayersUI();
      drawPixels();
    }
    if (!skipPreviewUpdate) updatePreview();
  }

  async function importFolder(files) {
    let matched = 0;
    let failed = 0;
    for (const file of files) {
      const fname = file.name.replace(/\.png$/i, "");
      if (partData[fname]) {
        try {
          await importPNG(fname, file, true); // skip preview update
          matched++;
        } catch (e) {
          console.error("Failed to import part:", fname, e);
          failed++;
        }
      }
    }
    if (matched > 0) {
      updatePreview();
      toast(`Imported ${matched} part(s)` + (failed > 0 ? ` (${failed} failed)` : ""), "ok");
    } else {
      toast(failed > 0 ? `Failed to import ${failed} part(s)` : "No matching filenames found", "err");
    }
  }

  function partToBlob(name) {
    const d = partData[name];
    return new Promise(resolve => d.canvas.toBlob(resolve, "image/png"));
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
          const res = await fetch(`assets/base-skin/${p.folder}/${p.name}.txt`);
          if (res.ok) {
            const txt = await res.text();
            files.push({ name: `${skinName}/${p.folder}/${p.name}.txt`, data: new TextEncoder().encode(txt) });
          }
        } catch (err) {
          console.error("Failed to process txt manifest for", p.name, err);
        }
      }
    }
    const zipBlob = ExpieZip.createZip(files);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url; a.download = `${skinName}.zip`; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${skinName}.zip`, "ok");
  }

  function resetPart(name, skipPreviewUpdate) {
    const d = partData[name];
    pushUndo(name);

    d.pixels = new Uint8ClampedArray(d.base);
    d.layers = [{
      id: Date.now() + Math.random(),
      name: "Base Layer",
      visible: true,
      opacity: 1.0,
      pixels: new Uint8ClampedArray(d.pixels)
    }];
    d.activeLayerIndex = 0;
    updateCachedCanvas(name);
    d.edited = false;
    updatePartMetaUI(name);
    drawThumb(name);
    if (name === currentPart) {
      renderLayersUI();
      drawPixels();
    }
    if (!skipPreviewUpdate) updatePreview();
  }

  function resetAll() {
    if (!confirm("Reset all parts to the base Expie skin?")) return;
    for (const name of Object.keys(partData)) resetPart(name, true);
    updatePreview();
    toast("All parts reset to base", "ok");
  }

  // ─── Event binding ─────────────────────────────────────────────────
  function bindEvents() {
    // Canvas drawing
    editCanvas.addEventListener("pointerdown", onPointerDown);
    editCanvas.addEventListener("pointermove", onPointerMove);
    editCanvas.addEventListener("pointerup", onPointerUp);
    editCanvas.addEventListener("pointercancel", onPointerUp);
    editCanvas.addEventListener("pointerleave", () => { $("#cursorPos").textContent = ""; });
    // Prevent context menu on canvas
    editCanvas.addEventListener("contextmenu", e => e.preventDefault());

    // Zoom via mouse wheel when hovering over canvas wrapper
    $(".canvas-wrap").addEventListener("wheel", e => {
      e.preventDefault();
      if (referenceImage && (e.altKey || e.shiftKey)) {
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        overlayScale = Math.min(8.0, Math.max(0.1, overlayScale + delta));
        if (typeof syncOverlayUI === "function") syncOverlayUI();
        renderCanvases();
        return;
      }
      const delta = e.deltaY < 0 ? 1 : -1;
      const newZoom = Math.min(40, Math.max(4, zoom + delta));
      if (newZoom !== zoom) {
        zoom = newZoom;
        zoomSlider.value = zoom;
        renderCanvases();
      }
    }, { passive: false });

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
    $("#addSwatch").addEventListener("click", () => {
      const hex = rgbaToHex(color.r, color.g, color.b);
      addSwatchToPalette(hex, true);
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
    if (mirrorToggle) {
      mirrorToggle.addEventListener("change", () => {
        renderCanvases();
      });
    }

    // Undo/redo
    $("#undoBtn").addEventListener("click", undo);
    $("#redoBtn").addEventListener("click", redo);

    // Canvas Flipping
    const flipHorizBtn = $("#flipHorizBtn");
    const flipVertBtn = $("#flipVertBtn");
    if (flipHorizBtn) flipHorizBtn.addEventListener("click", flipHorizontal);
    if (flipVertBtn) flipVertBtn.addEventListener("click", flipVertical);

    document.addEventListener("keydown", e => {
      if (e.target.matches("input,select,textarea")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); }
      if (e.key === "b" || e.key === "B") setTool("pencil");
      if (e.key === "e" || e.key === "E") setTool("eraser");
      if (e.key === "g" || e.key === "G") setTool("fill");
      if (e.key === "r" || e.key === "R") setTool("replace");
      if (e.key === "s" || e.key === "S") setTool("shading");
      if (e.key === "i" || e.key === "I") setTool("picker");
      if (e.key === "h" || e.key === "H") { e.preventDefault(); flipHorizontal(); }
      if (e.key === "v" || e.key === "V") { e.preventDefault(); flipVertical(); }
    });

    // Import/export
    $("#importFolderBtn").addEventListener("click", () => $("#importFolder").click());
    $("#importFolder").addEventListener("change", async (e) => {
      await importFolder(e.target.files);
      e.target.value = "";
    });
    $("#importPartBtn").addEventListener("click", () => $("#importPart").click());
    $("#importPart").addEventListener("change", async (e) => {
      if (e.target.files[0] && currentPart) {
        try {
          await importPNG(currentPart, e.target.files[0]);
          toast(`Imported into ${currentPart}`, "ok");
        } catch (err) {
          console.error(err);
          toast(`Failed to import PNG`, "err");
        }
        e.target.value = "";
      }
    });
    $("#partResetBtn").addEventListener("click", () => { if (currentPart) resetPart(currentPart); });
    $("#resetAllBtn").addEventListener("click", resetAll);
    $("#exportBtn").addEventListener("click", exportSkin);

    // Image Overlay bindings
    const importOverlay = $("#importOverlay");
    const importOverlayBtn = $("#importOverlayBtn");
    const activeOverlayControls = $("#activeOverlayControls");
    const clearOverlayBtn = $("#clearOverlayBtn");
    const overlayOpacity = $("#overlayOpacity");
    const overlaySettingsBtn = $("#overlaySettingsBtn");
    const overlayPopover = $("#overlayPopover");
    const closePopoverBtn = $("#closePopoverBtn");
    const overlayFitSelect = $("#overlayFitSelect");
    const overlayScaleSlider = $("#overlayScaleSlider");
    const overlayOffsetXInput = $("#overlayOffsetXInput");
    const overlayOffsetYInput = $("#overlayOffsetYInput");
    const overlayFilterInvertInput = $("#overlayFilterInvert");
    const overlayFilterGrayscaleInput = $("#overlayFilterGrayscale");
    const overlayFilterTintToggle = $("#overlayFilterTintToggle");
    const overlayFilterTintColorInput = $("#overlayFilterTintColor");
    const resetOverlayPosBtn = $("#resetOverlayPosBtn");

    function syncOverlayUI() {
      if (referenceImage) {
        if (activeOverlayControls) activeOverlayControls.style.display = "flex";
        
        const scaleVal = $("#overlayScaleVal");
        if (scaleVal) scaleVal.textContent = Math.round(overlayScale * 100) + "%";
        if (overlayScaleSlider) overlayScaleSlider.value = Math.round(overlayScale * 100);

        if (overlayOffsetXInput) overlayOffsetXInput.value = Number(overlayOffsetX.toFixed(1));
        if (overlayOffsetYInput) overlayOffsetYInput.value = Number(overlayOffsetY.toFixed(1));
        
        if (overlayFitSelect) overlayFitSelect.value = overlayFitMode;

        if (overlayFilterInvertInput) overlayFilterInvertInput.checked = overlayFilterInvert;
        if (overlayFilterGrayscaleInput) overlayFilterGrayscaleInput.checked = overlayFilterGrayscale;
        if (overlayFilterTintToggle) overlayFilterTintToggle.checked = overlayFilterTint;

        if (overlayFilterTintColorInput) {
          overlayFilterTintColorInput.value = overlayFilterTintColor;
          overlayFilterTintColorInput.disabled = !overlayFilterTint;
        }

        updateOverlayFilters();
      } else {
        if (activeOverlayControls) activeOverlayControls.style.display = "none";
        if (overlayPopover) overlayPopover.hidden = true;
      }
    }
    // Expose to outer scope of bindEvents if needed
    window.syncOverlayUI = syncOverlayUI;

    if (importOverlayBtn && importOverlay) {
      importOverlayBtn.addEventListener("click", () => importOverlay.click());
    }

    if (importOverlay) {
      importOverlay.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
          const img = new Image();
          img.onload = () => {
            referenceImage = img;
            overlayOffsetX = 0;
            overlayOffsetY = 0;
            overlayScale = 1.0;
            overlayFitMode = "contain";
            overlayFilterInvert = false;
            overlayFilterGrayscale = false;
            overlayFilterTint = false;
            
            syncOverlayUI();
            if (overlayPopover) overlayPopover.hidden = true;
            renderCanvases();
            toast("Reference overlay loaded!", "ok");
          };
          img.src = URL.createObjectURL(file);
        }
      });
    }

    if (clearOverlayBtn) {
      clearOverlayBtn.addEventListener("click", () => {
        referenceImage = null;
        syncOverlayUI();
        if (importOverlay) importOverlay.value = "";
        renderCanvases();
        toast("Reference overlay removed.");
      });
    }

    if (overlayOpacity) {
      overlayOpacity.addEventListener("input", () => {
        const val = overlayOpacity.value;
        const valSpan = $("#overlayOpacityVal");
        if (valSpan) valSpan.textContent = val + "%";
        if (referenceCanvas) {
          referenceCanvas.style.opacity = val / 100;
        }
      });
    }

    if (overlaySettingsBtn && overlayPopover) {
      overlaySettingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        overlayPopover.hidden = !overlayPopover.hidden;
      });
      overlayPopover.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      document.addEventListener("click", () => {
        overlayPopover.hidden = true;
      });
    }

    if (closePopoverBtn && overlayPopover) {
      closePopoverBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        overlayPopover.hidden = true;
      });
    }

    if (overlayFitSelect) {
      overlayFitSelect.addEventListener("change", (e) => {
        overlayFitMode = e.target.value;
        renderCanvases();
      });
    }

    if (overlayScaleSlider) {
      overlayScaleSlider.addEventListener("input", (e) => {
        overlayScale = parseFloat(e.target.value) / 100;
        const scaleVal = $("#overlayScaleVal");
        if (scaleVal) scaleVal.textContent = e.target.value + "%";
        renderCanvases();
      });
    }

    if (overlayOffsetXInput) {
      overlayOffsetXInput.addEventListener("input", (e) => {
        overlayOffsetX = parseFloat(e.target.value) || 0;
        renderCanvases();
      });
    }

    if (overlayOffsetYInput) {
      overlayOffsetYInput.addEventListener("input", (e) => {
        overlayOffsetY = parseFloat(e.target.value) || 0;
        renderCanvases();
      });
    }

    if (overlayFilterInvertInput) {
      overlayFilterInvertInput.addEventListener("change", (e) => {
        overlayFilterInvert = e.target.checked;
        updateOverlayFilters();
      });
    }

    if (overlayFilterGrayscaleInput) {
      overlayFilterGrayscaleInput.addEventListener("change", (e) => {
        overlayFilterGrayscale = e.target.checked;
        updateOverlayFilters();
      });
    }

    if (overlayFilterTintToggle) {
      overlayFilterTintToggle.addEventListener("change", (e) => {
        overlayFilterTint = e.target.checked;
        if (overlayFilterTintColorInput) {
          overlayFilterTintColorInput.disabled = !overlayFilterTint;
        }
        renderCanvases();
      });
    }

    if (overlayFilterTintColorInput) {
      overlayFilterTintColorInput.addEventListener("input", (e) => {
        overlayFilterTintColor = e.target.value;
        renderCanvases();
      });
    }

    if (resetOverlayPosBtn) {
      resetOverlayPosBtn.addEventListener("click", () => {
        overlayOffsetX = 0;
        overlayOffsetY = 0;
        overlayScale = 1.0;
        overlayFitMode = "contain";
        syncOverlayUI();
        renderCanvases();
        toast("Positioning reset.", "ok");
      });
    }

    // Preview selects
    previewHead.addEventListener("change", updatePreview);
    previewEyes.addEventListener("change", updatePreview);

    // Replace settings
    $("#replaceTolerance").addEventListener("input", () => {
      $("#toleranceVal").textContent = $("#replaceTolerance").value;
    });

    // Shading settings
    $("#shadingIntensity").addEventListener("input", () => {
      $("#shadingIntensityVal").textContent = $("#shadingIntensity").value + "%";
    });

    // Sprite FX Smart Outlining
    $("#outlineOuterBtn").addEventListener("click", () => outlineSprite("outer"));
    $("#outlineInnerBtn").addEventListener("click", () => outlineSprite("inner"));

    // Brush opacity
    $("#brushOpacity").addEventListener("input", () => {
      $("#brushOpacityVal").textContent = $("#brushOpacity").value + "%";
    });

    // Skin Name auto-save
    $("#skinName").addEventListener("input", saveLocalState);

    // Settings Panel and Snapshots
    const settingsModal = $("#settingsModal");
    $("#settingsBtn").addEventListener("click", () => {
      renderSkinsLibraryList();
      renderSnapshotsList();
      settingsModal.hidden = false;
    });

    $("#closeSettingsBtn").addEventListener("click", () => {
      settingsModal.hidden = true;
    });

    // Close settings modal if clicking outside the card
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        settingsModal.hidden = true;
      }
    });

    // Info Panel Manual
    const infoModal = $("#infoModal");
    const infoBtn = $("#infoBtn");
    if (infoBtn && infoModal) {
      infoBtn.addEventListener("click", () => {
        infoModal.hidden = false;
      });

      const closeInfoBtn = $("#closeInfoBtn");
      if (closeInfoBtn) {
        closeInfoBtn.addEventListener("click", () => {
          infoModal.hidden = true;
        });
      }

      infoModal.addEventListener("click", (e) => {
        if (e.target === infoModal) {
          infoModal.hidden = true;
        }
      });
    }



    // Changelog Panel
    const changelogModal = $("#changelogModal");
    const changelogBtn = $("#changelogBtn");
    const changelogContent = $("#changelogContent");
    if (changelogBtn && changelogModal && changelogContent) {
      async function loadAndShowChangelog() {
        changelogModal.hidden = false;
        changelogContent.innerHTML = `<p style="text-align: center; color: var(--muted); padding: 24px;">Loading changelog...</p>`;
        try {
          const response = await fetch("CHANGELOG.md");
          if (!response.ok) {
            throw new Error(`Status ${response.status}`);
          }
          const mdText = await response.text();
          changelogContent.innerHTML = parseMarkdown(mdText);
        } catch (error) {
          console.error("Failed to load changelog:", error);
          changelogContent.innerHTML = `<p style="text-align: center; color: #ff5555; padding: 24px;">⚠️ Failed to load CHANGELOG.md: ${error.message}</p>`;
        }
      }

      changelogBtn.addEventListener("click", loadAndShowChangelog);

      const closeChangelogBtn = $("#closeChangelogBtn");
      if (closeChangelogBtn) {
        closeChangelogBtn.addEventListener("click", () => {
          changelogModal.hidden = true;
        });
      }

      changelogModal.addEventListener("click", (e) => {
        if (e.target === changelogModal) {
          changelogModal.hidden = true;
        }
      });
    }

    // Contributors Panel
    const contributorsModal = $("#contributorsModal");
    const contributorsBtn = $("#contributorsBtn");
    const contributorsContent = $("#contributorsContent");
    if (contributorsBtn && contributorsModal && contributorsContent) {
      async function loadAndShowContributors() {
        contributorsModal.hidden = false;
        contributorsContent.innerHTML = `<p style="text-align: center; color: var(--muted); padding: 24px;">Loading contributors...</p>`;
        try {
          const response = await fetch("CONTRIBUTORS.md");
          if (!response.ok) {
            throw new Error(`Status ${response.status}`);
          }
          const mdText = await response.text();
          contributorsContent.innerHTML = parseMarkdown(mdText);
        } catch (error) {
          console.error("Failed to load contributors:", error);
          contributorsContent.innerHTML = `<p style="text-align: center; color: #ff5555; padding: 24px;">⚠️ Failed to load CONTRIBUTORS.md: ${error.message}</p>`;
        }
      }

      contributorsBtn.addEventListener("click", loadAndShowContributors);

      const closeContributorsBtn = $("#closeContributorsBtn");
      if (closeContributorsBtn) {
        closeContributorsBtn.addEventListener("click", () => {
          contributorsModal.hidden = true;
        });
      }

      contributorsModal.addEventListener("click", (e) => {
        if (e.target === contributorsModal) {
          contributorsModal.hidden = true;
        }
      });
    }



    $("#saveSkinToLibraryBtn").addEventListener("click", () => {
      const currentName = ($("#skinName").value || "MySkin").trim();
      const customName = prompt("Save skin under name:", currentName);
      if (customName === null) return; // cancelled
      const normalizedName = customName.trim() || currentName;
      saveSkinToLibrary(normalizedName);
    });

    $("#autoSnapshotToggle").addEventListener("change", startSnapshotTimer);
    $("#snapshotIntervalSelect").addEventListener("change", startSnapshotTimer);

    const themeSelect = $("#themeSelect");
    if (themeSelect) {
      themeSelect.addEventListener("change", (e) => {
        const selected = e.target.value;
        localStorage.setItem("expie_theme", selected);
        applyTheme(selected);
      });
    }

    $("#takeManualSnapshotBtn").addEventListener("click", () => {
      const hasEdited = Object.values(partData).some(d => d.edited);
      if (!hasEdited) {
        if (!confirm("Your workspace has no edits. Do you still want to save a base snapshot?")) {
          return;
        }
      }
      const customName = prompt("Enter a label/name for this snapshot:", "Checkpoint");
      if (customName === null) return; // user cancelled
      createSnapshot(false, customName.trim() || "Checkpoint");
    });

    const addLayerBtn = $("#addLayerBtn");
    if (addLayerBtn) {
      addLayerBtn.addEventListener("click", addLayer);
    }

    $("#dangerResetBtn").addEventListener("click", resetEverything);

    $("#exportSettingsBtn").addEventListener("click", exportBackup);
    $("#importSettingsBtn").addEventListener("click", () => {
      $("#importSettingsFileInput").click();
    });
    $("#importSettingsFileInput").addEventListener("change", (e) => {
      importBackup(e.target.files[0]);
    });
  }

  // ─── Layers Core Logic ─────────────────────────────────────────────
  function ensureLayers(name) {
    const d = partData[name];
    if (!d) return;

    if (!d.layers || d.layers.length === 0) {
      d.layers = [{
        id: Date.now() + Math.random(),
        name: "Base Layer",
        visible: true,
        opacity: 1.0,
        pixels: new Uint8ClampedArray(d.pixels)
      }];
      d.activeLayerIndex = 0;
    }

    if (d.activeLayerIndex === undefined || d.activeLayerIndex < 0 || d.activeLayerIndex >= d.layers.length) {
      d.activeLayerIndex = d.layers.length - 1;
    }
  }

  function compositeLayers(name) {
    const d = partData[name];
    if (!d) return;
    ensureLayers(name);

    if (!d.compCanvas) {
      d.compCanvas = document.createElement("canvas");
      d.compCanvas.width = d.w;
      d.compCanvas.height = d.h;
      d.compCtx = d.compCanvas.getContext("2d");
    }
    if (!d.layerCanvas) {
      d.layerCanvas = document.createElement("canvas");
      d.layerCanvas.width = d.w;
      d.layerCanvas.height = d.h;
      d.layerCtx = d.layerCanvas.getContext("2d");
    }

    const compCtx = d.compCtx;
    const layerCtx = d.layerCtx;

    compCtx.clearRect(0, 0, d.w, d.h);

    for (const ly of d.layers) {
      if (!ly.visible) continue;
      if (ly.opacity <= 0) continue;

      // Put the layer's pixels on the layerCanvas
      const imgData = new ImageData(ly.pixels, d.w, d.h);
      layerCtx.putImageData(imgData, 0, 0);

      // Draw onto compCanvas with correct globalAlpha
      compCtx.save();
      compCtx.globalAlpha = ly.opacity;
      compCtx.drawImage(d.layerCanvas, 0, 0);
      compCtx.restore();
    }

    // Copy the final composited image back to d.pixels
    const finalImgData = compCtx.getImageData(0, 0, d.w, d.h);
    d.pixels.set(finalImgData.data);

    // Update the main cached canvas
    const ctx = d.canvas.getContext("2d");
    ctx.clearRect(0, 0, d.w, d.h);
    ctx.putImageData(finalImgData, 0, 0);
  }

  function addLayer() {
    if (!currentPart) return;
    const d = partData[currentPart];
    ensureLayers(currentPart);

    pushUndo(currentPart);

    const newLayerId = Date.now() + Math.random();
    const newLayerName = `Layer ${d.layers.length + 1}`;
    const newPixels = new Uint8ClampedArray(d.w * d.h * 4);

    d.layers.push({
      id: newLayerId,
      name: newLayerName,
      visible: true,
      opacity: 1.0,
      pixels: newPixels
    });

    d.activeLayerIndex = d.layers.length - 1;

    compositeLayers(currentPart);
    renderLayersUI();
    drawPixels();
    saveLocalState();
    toast(`Layer "${newLayerName}" created`, "ok");
  }

  function deleteLayer(index) {
    if (!currentPart) return;
    const d = partData[currentPart];
    ensureLayers(currentPart);

    if (d.layers.length <= 1) {
      toast("Cannot delete the only remaining layer", "err");
      return;
    }

    const nameToDelete = d.layers[index].name;
    if (!confirm(`Are you sure you want to delete layer "${nameToDelete}"?`)) return;

    pushUndo(currentPart);

    d.layers.splice(index, 1);

    if (d.activeLayerIndex >= d.layers.length) {
      d.activeLayerIndex = d.layers.length - 1;
    }

    compositeLayers(currentPart);
    renderLayersUI();
    drawPixels();
    saveLocalState();
    toast(`Deleted layer "${nameToDelete}"`, "ok");
  }

  function moveLayer(index, direction) {
    if (!currentPart) return;
    const d = partData[currentPart];
    ensureLayers(currentPart);

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= d.layers.length) return;

    pushUndo(currentPart);

    const temp = d.layers[index];
    d.layers[index] = d.layers[targetIndex];
    d.layers[targetIndex] = temp;

    if (d.activeLayerIndex === index) {
      d.activeLayerIndex = targetIndex;
    } else if (d.activeLayerIndex === targetIndex) {
      d.activeLayerIndex = index;
    }

    compositeLayers(currentPart);
    renderLayersUI();
    drawPixels();
    saveLocalState();
  }

  function toggleLayerVisibility(index) {
    if (!currentPart) return;
    const d = partData[currentPart];
    ensureLayers(currentPart);

    pushUndo(currentPart);

    d.layers[index].visible = !d.layers[index].visible;

    compositeLayers(currentPart);
    renderLayersUI();
    drawPixels();
    saveLocalState();
  }

  function setLayerOpacity(index, opacity) {
    if (!currentPart) return;
    const d = partData[currentPart];
    ensureLayers(currentPart);

    d.layers[index].opacity = opacity;

    compositeLayers(currentPart);
    drawPixels();
  }

  function renameLayer(index, newName) {
    if (!currentPart) return;
    const d = partData[currentPart];
    ensureLayers(currentPart);

    const oldName = d.layers[index].name;
    if (oldName === newName) return;

    pushUndo(currentPart);
    d.layers[index].name = newName;
    saveLocalState();
  }

  function renderLayersUI() {
    const listEl = $("#layersList");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!currentPart) return;
    const d = partData[currentPart];
    if (!d) return;

    ensureLayers(currentPart);

    // Render layers in reverse order (top layer first)
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const ly = d.layers[i];
      const isActive = i === d.activeLayerIndex;

      const item = document.createElement("div");
      item.className = "layer-item" + (isActive ? " active" : "");

      // Row 1: Top Row (Visibility button, 32x32px Thumbnail, and Name Input)
      const topRow = document.createElement("div");
      topRow.className = "layer-item-top-row";

      const visBtn = document.createElement("button");
      visBtn.className = "layer-item-btn";
      visBtn.innerHTML = ly.visible ? "👁" : "➖";
      visBtn.title = ly.visible ? "Hide Layer" : "Show Layer";
      visBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleLayerVisibility(i);
      });

      const thumb = document.createElement("canvas");
      thumb.className = "layer-preview-thumb";
      thumb.width = d.w;
      thumb.height = d.h;
      const thumbCtx = thumb.getContext("2d");
      thumbCtx.imageSmoothingEnabled = false;
      const imgData = new ImageData(new Uint8ClampedArray(ly.pixels), d.w, d.h);
      thumbCtx.putImageData(imgData, 0, 0);

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "layer-name-input";
      nameInput.value = ly.name;
      nameInput.title = "Double-click to rename";
      nameInput.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          nameInput.blur();
        }
      });
      let originalName = ly.name;
      nameInput.addEventListener("focus", (e) => {
        originalName = e.target.value;
      });
      nameInput.addEventListener("blur", (e) => {
        const val = e.target.value.trim();
        if (val && val !== originalName) {
          renameLayer(i, val);
          toast(`Layer renamed to "${val}"`, "info");
        } else {
          e.target.value = originalName;
        }
      });

      topRow.appendChild(visBtn);
      topRow.appendChild(thumb);
      topRow.appendChild(nameInput);

      // Row 2: Bottom Row (Opacity slider, controls)
      const bottomRow = document.createElement("div");
      bottomRow.className = "layer-item-bottom-row";

      // Opacity Container
      const opContainer = document.createElement("div");
      opContainer.className = "layer-opacity-container";
      opContainer.addEventListener("click", (e) => e.stopPropagation());

      const opSlider = document.createElement("input");
      opSlider.type = "range";
      opSlider.className = "layer-opacity-slider";
      opSlider.min = "0";
      opSlider.max = "100";
      opSlider.value = Math.round(ly.opacity * 100);
      opSlider.title = "Opacity";

      const opVal = document.createElement("span");
      opVal.className = "layer-opacity-val";
      opVal.textContent = Math.round(ly.opacity * 100) + "%";

      opSlider.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        pushUndo(currentPart);
      });
      opSlider.addEventListener("input", (e) => {
        e.stopPropagation();
        const val = parseFloat(e.target.value) / 100;
        setLayerOpacity(i, val);
        opVal.textContent = Math.round(val * 100) + "%";
      });
      opSlider.addEventListener("change", (e) => {
        e.stopPropagation();
        saveLocalState();
      });

      opContainer.appendChild(opSlider);
      opContainer.appendChild(opVal);

      // Reordering & deleting buttons group
      const btnGroup = document.createElement("div");
      btnGroup.className = "layer-item-buttons-group";

      const upBtn = document.createElement("button");
      upBtn.className = "layer-item-btn";
      upBtn.innerHTML = "▲";
      upBtn.title = "Move Up";
      if (i === d.layers.length - 1) {
        upBtn.style.opacity = "0.3";
        upBtn.style.cursor = "default";
      } else {
        upBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          moveLayer(i, 1);
        });
      }

      const downBtn = document.createElement("button");
      downBtn.className = "layer-item-btn";
      downBtn.innerHTML = "▼";
      downBtn.title = "Move Down";
      if (i === 0) {
        downBtn.style.opacity = "0.3";
        downBtn.style.cursor = "default";
      } else {
        downBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          moveLayer(i, -1);
        });
      }

      const delBtn = document.createElement("button");
      delBtn.className = "layer-item-btn";
      delBtn.innerHTML = "🗑";
      delBtn.title = "Delete Layer";
      if (d.layers.length <= 1) {
        delBtn.style.opacity = "0.3";
        delBtn.style.cursor = "default";
      } else {
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteLayer(i);
        });
      }

      btnGroup.appendChild(upBtn);
      btnGroup.appendChild(downBtn);
      btnGroup.appendChild(delBtn);

      bottomRow.appendChild(opContainer);
      bottomRow.appendChild(btnGroup);

      item.appendChild(topRow);
      item.appendChild(bottomRow);

      item.addEventListener("click", () => {
        d.activeLayerIndex = i;
        renderLayersUI();
      });

      listEl.appendChild(item);
    }
  }


  function updateLayerThumbs() {
    if (!currentPart) return;
    const d = partData[currentPart];
    if (!d || !d.layers) return;

    const listEl = $("#layersList");
    if (!listEl) return;

    const items = listEl.querySelectorAll(".layer-item");
    if (items.length !== d.layers.length) return;

    for (let i = 0; i < d.layers.length; i++) {
      const lyIndex = d.layers.length - 1 - i;
      const ly = d.layers[lyIndex];
      const item = items[i];

      const canvas = item.querySelector(".layer-preview-thumb");
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, d.w, d.h);
        const imgData = new ImageData(new Uint8ClampedArray(ly.pixels), d.w, d.h);
        ctx.putImageData(imgData, 0, 0);
      }
    }
  }


  function parseMarkdown(md) {
    const lines = md.split('\n');
    let html = '';
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Handle horizontal rule
      if (line.trim() === '---') {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        html += '<hr class="changelog-divider">';
        continue;
      }

      // Handle headers
      if (line.startsWith('# ')) {
        if (inList) { html += '</ul>'; inList = false; }
        const text = line.substring(2).trim();
        html += `<h1>${text}</h1>`;
        continue;
      }
      if (line.startsWith('## ')) {
        if (inList) { html += '</ul>'; inList = false; }
        const text = line.substring(3).trim();
        html += `<h2>${text}</h2>`;
        continue;
      }
      if (line.startsWith('### ')) {
        if (inList) { html += '</ul>'; inList = false; }
        const text = line.substring(4).trim();
        html += `<h3>${text}</h3>`;
        continue;
      }
      if (line.startsWith('#### ')) {
        if (inList) { html += '</ul>'; inList = false; }
        const text = line.substring(5).trim();
        html += `<h4>${text}</h4>`;
        continue;
      }

      // Handle list items
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (!inList) {
          html += '<ul class="changelog-list">';
          inList = true;
        }
        const isSubList = line.startsWith('  ') || line.startsWith('\t');
        const text = parseInlineMarkdown(trimmed.substring(2));
        if (isSubList) {
          html += `<li style="margin-left: 20px; list-style-type: circle;">${text}</li>`;
        } else {
          html += `<li>${text}</li>`;
        }
        continue;
      }

      // If we were in a list, and the line is not empty and not a list item, close the list
      if (inList && trimmed !== '' && !trimmed.startsWith('- ') && !trimmed.startsWith('* ')) {
        html += '</ul>';
        inList = false;
      }

      // Handle empty line
      if (trimmed === '') {
        continue;
      }

      // Handle normal paragraph
      const text = parseInlineMarkdown(trimmed);
      html += `<p>${text}</p>`;
    }

    if (inList) {
      html += '</ul>';
    }

    return html;
  }

  function parseInlineMarkdown(text) {
    // Convert code blocks `code`
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Convert bold **bold**
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Convert italic *italic*
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Convert links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: var(--active); text-decoration: underline;">$1</a>');
    return text;
  }





  // ─── Init ──────────────────────────────────────────────────────────
  init().catch(err => {
    console.error("Init failed:", err);
    toast("Failed to load skin data. Check console.", "err");
  });
})();
