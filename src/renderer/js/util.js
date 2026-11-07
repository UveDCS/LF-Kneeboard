// Utilidades de interfaz compartidas por el kneeboard y los ajustes.

// Crea elementos: h('div.clase#id', { onclick, style, ... }, hijos...)
export function h(sel, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null) children.unshift(attrs);
    attrs = {};
  }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'className' || k === 'class') {
      for (const c of String(v).split(/\s+/)) if (c) el.classList.add(c);
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    // Un <textarea> no tiene atributo value: hay que darle el texto como propiedad o se dibuja vacío
    // (y lo siguiente que escribas pisa lo guardado).
    else if (k === 'value' && el.tagName === 'TEXTAREA') el.value = String(v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const pad = (n, w = 2) => String(n).padStart(w, '0');

export function hms(sec, withSec = true) {
  if (sec == null || !Number.isFinite(sec)) return '--:--';
  const s = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const t = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`;
  return withSec ? `${t}:${pad(s % 60)}` : t;
}

export function dur(sec) {
  if (sec == null || !Number.isFinite(sec)) return '--:--';
  const neg = sec < 0;
  sec = Math.abs(Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${neg ? '−' : ''}${h ? `${h}:${pad(m)}` : m}:${pad(s)}`;
}

export const deg = (d) => (d == null || !Number.isFinite(d) ? '---' : `${pad(Math.round(((d % 360) + 360) % 360) || 360, 3)}°`);
export const nm = (d, dec = 1) => (d == null || !Number.isFinite(d) ? '--' : d.toFixed(d >= 100 ? 0 : dec));
export const ft = (m) => (m == null || !Number.isFinite(m) ? '--' : Math.round(m * 3.28084).toLocaleString('es-ES'));

export function freq(f, mod) {
  if (f == null || !Number.isFinite(Number(f))) return '—';
  const v = Number(f) > 10000 ? Number(f) / 1e6 : Number(f);
  const s = v.toFixed(3).replace(/0{1,2}$/, '');
  return `${s}${mod === 1 ? ' FM' : ''}`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function emptyState(icon, title, text) {
  return h('div.empty', h('div.empty-icon', icon), h('div.empty-title', title), text ? h('div.empty-text', text) : null);
}

// Markdown sencillo (el de las notas de DKS): títulos, negrita, cursiva, listas y tablas.
export function mdToHtml(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  const lines = String(src || '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out.push(`<table class="tbl md"><thead><tr>${cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td class="txt">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^\s*[-*] /.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ''));
      i--;
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
    } else if (/^#{1,4} /.test(l)) {
      out.push(`<div class="h2">${inline(l.replace(/^#+ /, ''))}</div>`);
    } else if (l.trim()) {
      out.push(`<p>${inline(l)}</p>`);
    }
  }
  return out.join('');
}

export async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}
