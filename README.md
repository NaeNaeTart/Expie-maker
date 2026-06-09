# Expie Maker — Casualties: Unknown Skin Maker

A browser-based pixel-art editor for creating custom character skins for **Casualties: Unknown** (formerly Scav Prototype).

The game's player character (the "Expie") is composed of separate **Head** and **Body** sprite parts at tiny pixel dimensions. This tool lets you paint every part, preview the face, and export a game-ready skin folder as a `.zip`.

## Features

- **Per-part pixel editor** locked to each sprite's exact native dimensions (e.g. Head 28×16, Eyes 26×12, Tail 54×22).
- **Drawing tools**: Pencil, Eraser, Flood-fill, Eyedropper — with keyboard shortcuts.
- **Undo / Redo** per part (up to 60 levels).
- **Zoom + grid overlay** for precise editing.
- **Color picker** with alpha channel and a 32-swatch default palette (plus custom swatches).
- **Loads the real Expie base sprites** as the editable starting template.
- **Import** your own PNG per part, or batch-import a folder of PNGs by matching filenames.
- **Face preview** composites the selected head shape with eyes overlaid (approximate in-game layering).
- **Export** a complete `.zip` with the correct `Head/` + `Body/` folder structure, original filenames, and bundled Unity `.txt` metadata — ready to drop into the game.

## Getting Started

No build step required. Open `index.html` in any modern browser (Chrome, Firefox, Edge):

```bash
# Clone
git clone https://github.com/NaeNaeTart/Expie-maker.git
cd Expie-maker

# Open
# macOS: open index.html
# Linux: xdg-open index.html
# Windows: start index.html
# Or just double-click index.html in your file manager.
```

> **Note**: Because the app loads sprite assets via `fetch()`, opening the file directly (`file://`) may be blocked by CORS in some browsers. In that case, serve it locally:
>
> ```bash
> npx serve .
> # or
> python3 -m http.server 8000
> ```

## Using Your Skin In-Game

1. Export your skin `.zip` from the tool.
2. Extract the folder (e.g. `MySkin/`) into your game's custom-sprites directory:
   - **ChangeSkin mod**: `CasualtiesUnknownDemo/BepInEx/plugins/ChangeSkin/Skins/`
   - **Sprite Replacer mod**: `CasualtiesUnknownDemo/CustomSprites/st1/`
3. Follow the respective mod's instructions to load the skin in-game.

## Sprite Parts Reference

### Head (13 eyes · 10 head shapes · 1 extra)
| Part | Dimensions |
|------|-----------|
| Eyes (13 expressions) | 26×12 each |
| Head shapes (front, back, disfigured variants) | 28×16 each |
| Nosebleed | 14×12 |

### Body (10 parts)
| Part | Dimensions |
|------|-----------|
| Upper Torso / Down Torso | 10×12 each |
| Upper Arm | 6×14 |
| Down Arm | 6×16 |
| Thigh | 8×13 |
| Crus (shin) | 6×10 |
| Foot | 8×15 |
| Hand F / Hand B | 8×6 each |
| Tail | 54×22 |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| B | Pencil |
| E | Eraser |
| G | Fill |
| I | Eyedropper |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |

## Tech

Pure vanilla HTML/CSS/JS — no frameworks, no build step, no external dependencies. The ZIP export uses a bundled STORE-method writer (`zip.js`). Sprites are loaded from the `assets/base-skin/` folder.

## License

MIT
