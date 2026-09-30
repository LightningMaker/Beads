# Game artwork export URL · v1

Opening a valid export URL restores the 32 × 32 artwork and starts one PNG download. The page also offers a manual download button. The output is a transparent 1024 × 1024 PNG using the scene's 16-color palette, with no grid, labels, or background. This contract is implemented on the web side; the game still needs its URL-copying action.

For a local test, run `node Tools/BeadPattern/preview-server.cjs` from the Unity project root, then open `http://127.0.0.1:8765/test-export`. The local server generates the complete, validated example URL and redirects to it. This shortcut belongs to the local preview server; the published static page uses the fragment contract below.

Append these parameters to the published page URL **after `#`**:

```text
<page-url>#export=1&pattern=<1024-symbol-template>&style=holes&name=<URL-encoded-name>
```

| Parameter | Required | Value |
| --- | --- | --- |
| `export` | Yes | `1`, the protocol version. |
| `pattern` | Yes | Exactly 1024 uppercase symbols `0–9`, `A–G`. `0` is empty; `1–G` map to palette colors 1–16. |
| `style` | No | `holes` for round beads with transparent holes; `solid` for square pixels without holes. Defaults to `solid`. |
| `name` | No | URL-encoded artwork name, at most 128 UTF-16 code units after decoding and trimming. Defaults to a translated artwork name. |

The template runs left to right, **top row first**, matching `PBTemplates.patterns`. The first symbol is the top-left cell; symbol 32 is the top-right; symbol 993 is the bottom-left. When exporting a Unity board stored bottom row first, emit rows **31 down to 0**, keeping columns 0 through 31 within each row. Do not append the PlayerData collection record or pack the template into binary data.

The page rejects missing or invalid templates, unsupported versions or styles, duplicate parameters, names over the limit, and fragments longer than 8192 characters. Invalid links show an error and do not download. Ordinary page visits do not download. Query parameters before `#` do not trigger this flow.

For reference, this JavaScript creates a complete valid URL with four differently colored corners:

```js
const symbols = '0123456789ABCDEFG';
const cells = Array(1024).fill(0); // top-down order
cells[0] = 1;    // top left
cells[31] = 2;   // top right
cells[992] = 3;  // bottom left
cells[1023] = 16; // bottom right

const page = new URL('http://127.0.0.1:8765/'); // replace with the published page URL
page.hash = new URLSearchParams({
  export: '1',
  pattern: cells.map(value => symbols[value]).join(''),
  style: 'holes',
  name: 'Four corners'
}).toString();
console.log(page.href);
```

The same fragment works on a GitHub Pages project path such as `/BeadPattern/`; no server route or backend is required. Only `index.html` and `.nojekyll` are needed for deployment. Run `node --test codec.test.cjs` from this directory to validate the codec and export contract (the tests also read the adjacent Unity project).

The page generates the PNG from the URL data before the user edits the restored pattern. The download button retains that original image even if the crop or preview changes. Its filename ends in `_holes_1024.png` or `_solid_1024.png`. Browsers may block downloads started on page load; the visible download button lets the user retry with a click. The page reports that it has started the download, rather than claiming that the browser has saved the file.
