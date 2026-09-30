'use strict';

// Run with: node --test Tools/BeadPattern/codec.test.cjs
// The shipping page remains a standalone file; exercise its actual inline core.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');

const root = resolve(__dirname, '../..');
const html = readFileSync(resolve(__dirname, 'index.html'), 'utf8');
const templatesSource = readFileSync(resolve(root, 'Assets/PixelBeads/Scripts/PBTemplates.cs'), 'utf8');
const builderSource = readFileSync(resolve(root, 'Assets/PixelBeads/Editor/PBWorldBuilder.cs'), 'utf8');

function inlineModule(id, name, context = {}) {
  const script = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(script, `standalone page must expose the tested ${id} script`);
  return runInNewContext(`${script[1]}\n${name};`, context, { filename: `index.html#${id}`, timeout: 5000 });
}

const core = inlineModule('bead-core', 'BeadCore');
const i18n = inlineModule('bead-i18n', 'BeadI18n');
const exporter = inlineModule('bead-export', 'BeadExport', { URL, URLSearchParams, BeadCore: core });
const symbols = '0123456789ABCDEFG';
const patternsBlock = templatesSource.match(/public string\[\] patterns\s*=\s*new string\[\]\s*\{([\s\S]*?)\};/);
assert.ok(patternsBlock, 'locate actual scene patterns rather than copied fixtures');
const patterns = [...patternsBlock[1].matchAll(/"([0-9A-G]+)"/g)].map(match => match[1]);
const sameBytes = (actual, expected, message) => assert.deepEqual(Buffer.from(actual), Buffer.from(expected), message);

function rgbaFor(cells, alpha = 255) {
  const rgba = new Uint8ClampedArray(4096);
  cells.forEach((cell, index) => {
    if (!cell) return;
    rgba.set(core.rgb[cell - 1], index * 4);
    rgba[index * 4 + 3] = alpha;
  });
  return rgba;
}

test('all 16 palette values and order match both C# sources', () => {
  const paletteBlock = templatesSource.match(/public Color\[\] palette\s*=\s*new Color\[\]\s*\{([\s\S]*?)\};/);
  assert.ok(paletteBlock);
  const actualSceneColors = [...paletteBlock[1].matchAll(/new Color\(([^)]+)\)/g)].map(match =>
    match[1].split(',').map(value => Number.parseFloat(value)));
  assert.equal(actualSceneColors.length, 16);
  actualSceneColors.forEach((rgba, index) => {
    assert.equal(rgba[3], 1, 'scene bead colors are opaque');
    assert.deepEqual(Array.from(core.rgb[index]), rgba.slice(0, 3).map(value => Math.round(value * 255)));
  });
  const builderPalette = builderSource.match(/string\[\] hex\s*=\s*\{([^}]+)\}/);
  assert.ok(builderPalette);
  assert.deepEqual(Array.from(core.hex), [...builderPalette[1].matchAll(/"([0-9A-F]{6})"/g)].map(match => match[1]));
  assert.equal(core.symbols, symbols);
});

test('all 48 scene templates encode unchanged in top-down order', () => {
  assert.equal(patterns.length, 48, 'update coverage if the scene template library changes');
  assert.match(templatesSource, /Rows run top to bottom/);
  patterns.forEach((pattern, index) => {
    assert.equal(pattern.length, 1024, `template ${index} source length`);
    const cells = Uint8Array.from(pattern, symbol => symbols.indexOf(symbol));
    const original = cells.slice();
    assert.equal(core.template(cells), pattern, `template ${index} text output`);
    sameBytes(core.decodeTemplate(pattern), cells, `template ${index} decoding`);
    sameBytes(cells, original, 'encoding must not mutate input');
  });
});

function exportUrl(params, base = 'https://example.org/BeadPattern/') {
  const url = new URL(base);
  url.hash = new URLSearchParams(params).toString();
  return url.href;
}

test('game export URLs restore every scene template on root and Pages project paths', () => {
  for (const base of ['http://127.0.0.1:8765/', 'https://example.org/BeadPattern/']) {
    patterns.forEach((pattern, index) => {
      const result = exporter.parseUrl(exportUrl({ export: '1', pattern, style: 'holes', name: `作品 ${index} & + # / ?` }, base));
      assert.equal(core.template(result.cells), pattern);
      assert.equal(result.style, 'holes');
      assert.equal(result.name, `作品 ${index} & + # / ?`);
    });
  }
});

test('export defaults and all-empty artworks are supported without changing orientation', () => {
  const cells = new Uint8Array(1024);
  cells[0] = 1; cells[31] = 2; cells[992] = 3; cells[1023] = 16;
  const result = exporter.parseUrl(exportUrl({ export: '1', pattern: core.template(cells) }));
  sameBytes(result.cells, cells);
  assert.equal(result.style, 'solid');
  assert.equal(result.name, '');
  const empty = exporter.parseUrl(exportUrl({ export: '1', pattern: '0'.repeat(1024), name: '   ' }));
  sameBytes(empty.cells, new Uint8Array(1024));
  assert.equal(empty.name, '');
});

test('normal visits, unrelated fragments and query strings never trigger exports', () => {
  for (const url of ['https://example.org/', 'https://example.org/#crop', 'https://example.org/#lang=zh',
    `https://example.org/?export=1&pattern=${patterns[0]}`]) {
    assert.equal(exporter.parseUrl(url), null);
  }
});

test('export rejects invalid templates, versions, styles, duplicate fields and oversized input', () => {
  const valid = { export: '1', pattern: patterns[0] };
  const cases = [
    { pattern: patterns[0] }, { export: '1' }, { ...valid, export: '2' },
    { ...valid, pattern: patterns[0].slice(1) }, { ...valid, pattern: patterns[0] + '0' },
    { ...valid, pattern: patterns[0] + '\n' }, { ...valid, pattern: 'g'.repeat(1024) },
    { ...valid, pattern: 'H'.repeat(1024) }, { ...valid, pattern: ' '.repeat(1024) },
    { ...valid, pattern: `${'0'.repeat(1023)}<` }, { ...valid, style: 'chart' },
    { ...valid, style: '' }, { ...valid, name: 'x'.repeat(129) },
    { ...valid, extra: 'x'.repeat(8192) }
  ];
  for (const params of cases) assert.throws(() => exporter.parseUrl(exportUrl(params)));
  for (const key of ['export', 'pattern', 'style', 'name']) {
    const params = new URLSearchParams({ ...valid, style: 'solid', name: 'test' });
    params.append(key, params.get(key));
    assert.throws(() => exporter.parseUrl(`https://example.org/#${params}`));
  }
  for (const pattern of [null, undefined, [], patterns[0] + '\n']) assert.throws(() => core.decodeTemplate(pattern));
});

function drawingContext() {
  const calls = [];
  const g = { calls, fillStyle: '',
    clearRect: (...args) => calls.push(['clear', ...args]),
    fillRect: (...args) => calls.push(['square', g.fillStyle, ...args]),
    beginPath: () => calls.push(['path']),
    arc: (...args) => calls.push(['arc', ...args]),
    fill: rule => calls.push(['fill', g.fillStyle, rule])
  };
  return g;
}

test('solid artwork keeps exact corner colors and leaves empty cells transparent', () => {
  const cells = new Uint8Array(1024);
  cells[0] = 1; cells[31] = 2; cells[992] = 3; cells[1023] = 16;
  const g = drawingContext();
  exporter.drawArtwork(g, cells);
  assert.deepEqual(g.calls, [
    ['clear', 0, 0, 1024, 1024],
    ['square', '#FFF2D6', 0, 0, 32, 32],
    ['square', '#3A3540', 992, 0, 32, 32],
    ['square', '#F2797A', 0, 992, 32, 32],
    ['square', '#C95468', 992, 992, 32, 32]
  ]);
  const empty = drawingContext();
  exporter.drawArtwork(empty, new Uint8Array(1024));
  assert.deepEqual(empty.calls, [['clear', 0, 0, 1024, 1024]]);
});

test('hole artwork uses transparent rings with the original palette and validates output options', () => {
  const g = drawingContext(), cells = new Uint8Array(1024);
  cells[33] = 16;
  exporter.drawArtwork(g, cells, 'holes');
  assert.deepEqual(g.calls.map(call => call[0]), ['clear', 'path', 'arc', 'arc', 'fill']);
  assert.deepEqual(g.calls[2].slice(1, 4), [48, 48, 32 * .455]);
  assert.deepEqual(g.calls[3].slice(1, 4), [48, 48, 32 * .145]);
  assert.deepEqual(g.calls[4], ['fill', '#C95468', 'evenodd']);
  for (const style of ['chart', '', null]) assert.throws(() => exporter.drawArtwork(g, cells, style));
  for (const size of [0, 31, 4097, NaN, 32.5]) assert.throws(() => exporter.drawArtwork(g, cells, 'solid', size));
});

test('built-in cat demo is exactly the first scene template', () => {
  const demo = html.match(/function demo\(\)\s*\{[\s\S]*?const pattern='([0-9A-G]+)'/);
  assert.ok(demo);
  assert.equal(demo[1], patterns[0]);
});

test('asymmetric corners retain top-down, left-to-right orientation', () => {
  const cells = new Uint8Array(1024);
  cells[0] = 1; cells[31] = 2; cells[992] = 3; cells[1023] = 16;
  const encoded = core.template(cells);
  assert.equal(encoded.length, 1024);
  assert.equal(encoded.slice(0, 32), `1${'0'.repeat(30)}2`);
  assert.equal(encoded.slice(32, 992), '0'.repeat(960));
  assert.equal(encoded.slice(992), `3${'0'.repeat(30)}G`);
});

test('empty cells and all 16 colors produce exactly 1,024 template symbols', () => {
  assert.equal(core.template(new Uint8Array(1024)), '0'.repeat(1024));
  assert.equal(core.template(new Uint8Array(1024).fill(16)), 'G'.repeat(1024));
  const cells = Uint8Array.from({ length: 1024 }, (_, index) => index % 17);
  const encoded = core.template(cells);
  assert.match(encoded, /^[0-9A-G]{1024}$/);
  assert.equal(encoded.slice(0, 17), symbols);
  sameBytes(Uint8Array.from(encoded, symbol => symbols.indexOf(symbol)), cells);
});

test('all exact palette colors quantize to the same indices with and without dithering', () => {
  const cells = Uint8Array.from({ length: 1024 }, (_, index) => index % 16 + 1);
  const rgba = rgbaFor(cells);
  for (const dither of [false, true]) {
    sameBytes(core.quantize(rgba, { dither }), cells);
  }
  core.rgb.forEach((color, index) => assert.equal(core.nearest(...color), index + 1));
});

test('alpha threshold preserves blank cells and matte mode fills transparency', () => {
  const rgba = rgbaFor(new Uint8Array(1024).fill(3));
  const alphas = [0, 1, 127, 128, 254, 255];
  alphas.forEach((alpha, index) => { rgba[index * 4 + 3] = alpha; });
  for (const dither of [false, true]) {
    const cells = core.quantize(rgba, { empty: true, threshold: 128, dither });
    sameBytes(cells.subarray(0, 3), [0, 0, 0]);
    assert.ok(cells.subarray(3).every(value => value >= 1 && value <= 16));
    assert.equal(core.quantize(rgba, { empty: true, threshold: 1, dither })[0], 0, 'alpha zero remains blank');
    const matte = core.quantize(new Uint8ClampedArray(4096), { empty: false, matte: 8, dither });
    sameBytes(matte, new Uint8Array(1024).fill(8));
  }
});

test('dithering produces only valid indices and never colors transparent gaps', () => {
  const rgba = new Uint8ClampedArray(4096);
  for (let index = 0; index < 1024; index++) {
    const x = index % 32, y = Math.floor(index / 32);
    rgba.set([x * 255 / 31, y * 255 / 31, (x + y) * 255 / 62, x === 16 ? 0 : 255], index * 4);
  }
  const cells = core.quantize(rgba, { dither: true });
  assert.equal(cells.length, 1024);
  cells.forEach((value, index) => {
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 16);
    assert.equal(value === 0, index % 32 === 16, 'only the transparent column is empty');
  });
  assert.notDeepEqual(Buffer.from(cells), Buffer.from(core.quantize(rgba, { dither: false })), 'gradient should exercise error diffusion');
  assert.match(core.template(cells), /^[0-9A-G]{1024}$/);
});

test('template rejects malformed cell values and quantizer rejects wrong dimensions or matte', () => {
  const badValues = [-1, 17, 1.5, NaN, Infinity, '1', undefined];
  const invalid = [[], new Uint8Array(1023), new Uint8Array(1025), ...badValues.map(value => {
    const cells = Array(1024).fill(0); cells[777] = value; return cells;
  })];
  for (const cells of invalid) assert.throws(() => core.template(cells));
  assert.throws(() => core.quantize(new Uint8ClampedArray(4095)));
  assert.throws(() => core.quantize(new Uint8ClampedArray(4097)));
  for (const matte of [0, 17, NaN]) {
    assert.throws(() => core.quantize(new Uint8ClampedArray(4096), { matte }));
  }
});

test('browser language selects Chinese only for Chinese language tags', () => {
  for (const language of ['zh', 'zh-CN', 'zh-TW', 'zh-HK', 'zh-Hans', 'zh-Hant', 'zh-Hant-TW', 'ZH-cn']) {
    assert.equal(i18n.detect(language), 'zh', language);
  }
  for (const language of ['en', 'en-US', 'fr-FR', 'ja-JP', 'ko-KR', 'de-DE', '', undefined, null]) {
    assert.equal(i18n.detect(language), 'en', String(language));
  }
});

test('English and Chinese translations have matching keys and complete messages', () => {
  const { en, zh } = i18n.messages;
  assert.ok(en && zh, 'both supported locales are available');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  assert.ok(Object.keys(en).length > 20, 'translate the full interface');
  for (const language of ['en', 'zh']) {
    for (const [key, message] of Object.entries(i18n.messages[language])) {
      if (key === 'colorNames') {
        assert.equal(message.length, 16, 'every scene color has a translated name');
        assert.ok(message.every(name => typeof name === 'string' && name.trim()));
        assert.deepEqual(i18n.translate(language, key), message);
        continue;
      }
      assert.equal(typeof message, 'string', `${language}.${key}`);
      assert.ok(message.trim(), `${language}.${key} is not blank`);
      assert.equal(i18n.translate(language, key), message, `${language}.${key}`);
    }
  }
});

test('dynamic translations interpolate every message placeholder in both locales', () => {
  let interpolated = 0;
  for (const language of ['en', 'zh']) {
    for (const [key, message] of Object.entries(i18n.messages[language])) {
      if (typeof message !== 'string') continue;
      const placeholders = [...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
      if (!placeholders.length) continue;
      const vars = Object.fromEntries(placeholders.map(name => [name, `value-${name}`]));
      assert.equal(i18n.translate(language, key, vars), message.replace(/\{(\w+)\}/g, (_, name) => vars[name]));
      interpolated++;
    }
  }
  assert.ok(interpolated > 0, 'dynamic status and counts must be translated');
});

test('published page offers template output only', () => {
  assert.equal(typeof core.template, 'function');
  for (const removed of ['packSlot', 'packRecord', 'base64', 'names']) assert.equal(core[removed], undefined);
  assert.doesNotMatch(html, /id=["'](?:format|downloadBinary)["']/);
  assert.doesNotMatch(html, /function\s+(?:packSlot|packRecord|base64)\s*\(/);
  assert.doesNotMatch(html, /与场景存档格式一致|编码格式与使用说明|离线可用|仅在本机处理/);
});
