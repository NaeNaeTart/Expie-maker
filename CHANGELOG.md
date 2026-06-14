# Changelog

All notable changes to the **Expie-maker** skin editing platform will be documented in this file.

## [1.2.0] - 2026-06-14

### ✨ New Features

#### 🧪 1. Experimental UI Overhaul (Glassmorphism & Floating Cards)
- **High-Fidelity Dashboard Layout**: Opt-in to a sleek, modern glassmorphic theme dashboard that turns panels into floating, elevated glass cards (`backdrop-filter` saturation and blur overrides).
- **Interactive Micro-Animations**: Bouncy tool scaling and glows on active tools matching custom visual theme color accents, with hover side transitions on parts lists.
- **Ambient Ambient float Loop**: Smooth animated multi-gradient fluid layers (`ambientFloat`) that run in the viewport background to create depth.
- **Responsive Sizing Logic**: Recalibrated viewport grids (`calc(100vh - 92px)`) to keep editing operations and previews perfectly within the viewport boundaries, avoiding any vertical browser window scrolling.
- **Persistence & Fast Refreshes**: Integrates cleanly into `localStorage` (`expie_experimental_ui_overhaul`) and triggers zero-latency JS redraw checks without needing a page refresh.

#### 🎨 2. Palette Shading Ramp Generator
- **Multi-Step Shading Builder**: Automatically generate mathematical color progression ramps (lightness/darkness scales) from your active color selection.
- **Mathematical Shading Profiles**: Choose between **Warm-Cool Shifts**, **Monochromatic Steps**, and **Vibrant Highlights** to generate beautiful color paths.
- **Library Integration**: One-click library saving to instantly commit all generated shades to your active workspace swatches, allowing fast access to shaded tones.

---

## [1.1.0] - 2026-06-14

### ✨ New Features

#### 🌌 1. Premium Studio Theme Customizer
- **Five Curated Themes:** Instantly switch between custom visual aesthetics from the settings menu:
  - 🌌 **Obsidian Dusk (Default):** Sleek, deep dark studio design.
  - 🌸 **Cherry Blossom (Light):** A bright, charming pastel-pink layout with deep plum high-contrast readability.
  - 🤖 **Cyberpunk Neon (Dark):** Hot pink border glows with electric cyan accents and neon-green highlights.
  - 🪵 **Warm Oak (Dark):** Cozy forest-cabin wood styling with soft chocolate tones and amber accents.
  - 📟 **Matrix Terminal (Dark):** Classic green-on-black phosphor terminal vibe with glowing monospace borders.
- **Dynamic Checkerboard Synchronization:** The active editor canvas background automatically adapts its colors to the active theme, maintaining a high-fidelity visual experience in any workspace mode.

#### ↩️ 2. Unified Global Undo / Redo (CTRL+Z / CTRL+Y)
- **cascaded Reverts:** Pressing `CTRL+Z` after applying global outlines now reverts all affected skin parts and nested layers simultaneously in a single action, regardless of which part is currently selected.
- **Perfect Synchronization:** Both modified and unmodified parts are tracked in sync so history stays completely clean, and works flawlessly across browser reloads.

---

## [1.0.0] - 2026-06-14

Welcome to **Version 1.0.0** of Expie-maker! This release marks the culmination of advanced design systems, robust multi-layer rendering pipelines, and seamless cloudless synchronization features.

### 🚀 Key Features & Highlights

#### 🎭 1. Advanced Layer Stack Engine & Composition Pipeline
- **Seamless Layer Painting:** Fully isolated multi-layer canvas support for every single loaded skin part (Head, Body, Eyes, etc.).
- **Dynamic Real-Time Compositing:** Real-time merging of layer pixels with opacity blending at 60fps during live brush or pencil strokes.
- **Enhanced Reordering controls:** Easily reorder, toggle visibility, and delete layers dynamically.

#### 🎨 2. Premium Dual-Row Glassmorphic Layers UI
- **Generous 32x32px Previews:** Replaced tiny, unreadable thumbnails with generous **`32x32px` interactive preview canvases** equipped with high-contrast checkerboard transparency grids.
- **Double-Row Cards:** Redesigned layout to prevent layer name squishing. 
  - *Row 1 (Top):* Visibility toggle (👁), 32px pixel-art thumbnail, and a full-width rename input.
  - *Row 2 (Bottom):* Full-width `110px` opacity slider and reordering action buttons group (`▲`, `▼`, `🗑`).
- **Real-Time Copy Sync:** Layer thumbnails redraw instantly as you paint or stroke on the canvas.

#### ⚙️ 3. Backup & Sync (Export / Import Workspace)
- **Universal JSON Backups:** Export your entire local storage workspace (all edit layers, palette swatches, snapshots, library saved skins, and preferences) into a single portable `.json` backup file.
- **Instant Restore:** Import previous backups with automated data validation, browser-safe cleaning, and automatic hot-reloading for a seamless restoration experience.

#### 📸 4. Auto-Saves, Snapshots & Skins Library
- **Rolling Time-Based Snapshots:** Choose custom snapshot intervals (1, 3, 5, or 10 minutes) for automatic time-based checkpoints, preserving up to 10 historical state objects.
- **Saved Skins Library:** Save multiple, separate custom skins to your personal browser library, then load, duplicate, or delete them in seconds.
- **Robust Auto-Saves:** High-performance, low-overhead localStorage persistence that restores your workspace progress instantly if you refresh or close the tab.

#### 🖼️ 5. Trace Reference Overlay Panel
- **Multi-Fit Positioning:** Seamlessly upload reference images and trace them with full support for Stretch, Contain, Cover, and Original scaling layouts.
- **High-Contrast Tracing Filters:** Control tracing contrast dynamically with visual overlays (Invert colors, Grayscale conversion, and solid high-contrast Color Tint overlays).

#### ✨ 6. Global Sprite FX & Styling Polish
- **Global Outline FX:** Set inner and outer outlines once globally, applying the effect to all active parts and nested layers simultaneously.
- **Sleek Custom Scrollbars:** Added custom scrollbars (`5px`, translucent, curved) globally, completely eliminating annoying horizontal overflow while maintaining premium aesthetics.
