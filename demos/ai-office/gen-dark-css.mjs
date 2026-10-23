// Generates dist/office-dark.css: a dark twin of every colour rule in the AI Office stylesheets.
// Run after changing any of the source CSS:  node demos/ai-office/gen-dark-css.mjs
// Light surfaces turn dark and dark text turns light (hue kept, saturation softened); dark accent surfaces and
// light text are kept, so buttons such as white-on-green stay readable. Rules are scoped to ":root.dark",
// the class Office AI puts on <html> (see frontend/src/context/ThemeContext.jsx).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const SOURCES = ['style.css', 'office-layout.css', 'office-capabilities.css', 'office-projects.css', 'office-live.css', 'office-crew.css'];
// box-shadow is left alone (inverting dark shadows would make glows); text-shadow halos are darkened so light text stays crisp.
const PROPS = /^(color|text-shadow|background|background-color|background-image|border|border-(top|right|bottom|left)(-color)?|border-color|outline|outline-color|fill|stroke|accent-color|caret-color|--[\w-]+)$/;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// role: "text" | "border" | "bg". Dark accent surfaces and light text (white on a green button) are kept as they
// are; light surfaces turn dark and dark text turns light. The office's green/neutral tints are re-hued to the
// slate blue Office AI uses in dark mode (#1e2634 panels, #3a4352 borders); reds, ambers and other signal colours
// keep their hue so errors still look like errors.
const SLATE_HUE = 217 / 360;
function mapColor(original, [r, g, b], alpha, role) {
  const [h, s, l] = rgbToHsl(r, g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const brand = chroma < 8 || (h >= 65 / 360 && h <= 175 / 360); // neutral or the office's yellow-green / green tint
  let nl;
  if (role === 'text') {
    if (l >= .5) { // mid-tone muted text: only re-hue the greens
      if (!brand || l >= .85 || chroma < 8) return original;
      return hexOf(hslToRgb(SLATE_HUE, s * .4, l), alpha);
    }
    nl = clamp(1 - l * .5, .7, .93);
  } else if (role === 'border') { if (l < .5) return original; nl = .2 + (1 - l) * .55; }
  else { if (l < .5) return original; nl = .13 + (1 - l) * .4; }
  const rgb = brand ? hslToRgb(SLATE_HUE, role === 'text' ? .22 : .28, nl) : hslToRgb(h, s * .7, nl);
  return hexOf(rgb, alpha);
}
const hexOf = ([r, g, b], alpha) => { const hex = v => v.toString(16).padStart(2, '0'); return `#${hex(r)}${hex(g)}${hex(b)}${alpha === undefined ? '' : hex(Math.round(alpha * 255))}`; };
const roleOf = (prop, value) => /^(color|fill|stroke|caret-color)$/.test(prop) ? 'text' : /^(border|outline)/.test(prop) ? 'border'
  : prop.startsWith('--') ? (/^--(ink|muted|green|text|fg)/.test(prop) ? 'text' : /line|border/.test(prop) ? 'border' : 'bg') : 'bg';
function convert(prop, value) {
  const role = roleOf(prop, value);
  return value
    .replace(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g, (whole, hex) => {
      if (hex.length <= 4) hex = [...hex].map(c => c + c).join('');
      const n = parseInt(hex.slice(0, 6), 16);
      return mapColor(whole, [n >> 16, (n >> 8) & 255, n & 255], hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : undefined, role);
    })
    .replace(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)/g, (whole, r, g, b, a) => mapColor(whole, [+r, +g, +b], a === undefined ? undefined : +a, role))
    .replace(/\bwhite\b/g, whole => mapColor(whole, [255, 255, 255], undefined, role)).replace(/\bblack\b/g, whole => mapColor(whole, [0, 0, 0], undefined, role));
}
const hasColor = v => /#[0-9a-fA-F]{3,8}\b|rgba?\(|\bwhite\b|\bblack\b/.test(v);

function splitTop(text, sep) { // split on `sep` outside parentheses and quotes
  const out = []; let depth = 0, quote = '', cur = '';
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
function blocks(css) { // top-level `prelude { body }` pairs
  const out = []; let depth = 0, start = 0, prelude = '';
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) { prelude = css.slice(start, i).trim(); start = i + 1; } depth++; }
    else if (css[i] === '}') { depth--; if (depth === 0) { out.push([prelude, css.slice(start, i)]); start = i + 1; } }
  }
  return out;
}
const scope = selector => selector.split(',').map(s => s.trim()).filter(Boolean).map(s => /^(:root|html)\b/.test(s) ? s.replace(/^(:root|html)/, ':root.dark') : `:root.dark ${s}`).join(',');

function process(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+url\([^)]*\)\s*;/g, '').replace(/@charset[^;]*;/g, '');
  let out = '';
  for (const [prelude, body] of blocks(css)) {
    if (/^@(media|supports)/.test(prelude)) { const inner = process(body); if (inner) out += `${prelude}{${inner}}\n`; continue; }
    if (prelude.startsWith('@')) continue; // keyframes, font-face
    const decls = splitTop(body, ';').map(d => d.trim()).filter(Boolean).map(d => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; })
      .filter(([prop, value]) => PROPS.test(prop) && hasColor(value)).map(([prop, value]) => [prop, convert(prop, value), value]).filter(([, now, was]) => now !== was).map(([prop, now]) => `${prop}:${now}`);
    if (decls.length) out += `${scope(prelude)}{${decls.join(';')}}\n`;
  }
  return out;
}

let result = '/* Generated by demos/ai-office/gen-dark-css.mjs — do not edit by hand. */\n:root.dark{color-scheme:dark}\n';
for (const file of SOURCES) result += `/* ${file} */\n${process(fs.readFileSync(path.join(dist, file), 'utf8'))}`;
result += ':root.dark body{background:#0f1726}\n:root.dark ::-webkit-scrollbar-thumb{background:#475569}\n';
fs.writeFileSync(path.join(dist, 'office-dark.css'), result);
console.log(`office-dark.css: ${result.length} bytes`);
