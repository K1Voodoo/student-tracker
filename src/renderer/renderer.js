'use strict';

// ======================================================================
// State
// ======================================================================
let data = { students: [], settings: {} };
let reportsCache = {};          // student id -> [{path, mtime}]
let searchTerm = '';
let editingCount = null;        // "studentId|columnId" of the counter being edited
let pendingCount = 0;

const PERSONAL_FIELDS = [
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'country', label: 'Country', type: 'text' },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'timezone', label: 'Time zone', type: 'text' },
  { key: 'age', label: 'Age', type: 'text' },
  { key: 'nativeLanguage', label: 'Native language', type: 'text' },
  { key: 'occupation', label: 'Occupation', type: 'text' },
  { key: 'goal', label: 'Learning goal', type: 'text' },
  { key: 'startDate', label: 'Start date', type: 'date' },
  { key: 'schedule', label: 'Lesson schedule', type: 'text' },
  { key: 'preplyLink', label: 'Preply profile / chat link', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' }
];

// ---------- Columns ----------
// The columns are part of the data (data.settings.columns), so they are kept
// in backups and are not reset by updates. Each column says where its values
// live on the student: textKey (formatted text), filesKey (file list),
// countKey (number).
const COLUMN_TYPES = {
  list:     { label: 'List',          desc: 'Formatted text with bullet and numbered lists' },
  file:     { label: 'File',          desc: 'A list of documents (Browse to add)', width: 72 },
  listfile: { label: 'List and file', desc: 'Documents plus formatted notes' },
  counter:  { label: 'Counter',       desc: 'A number with − / + (like Lesson count)', width: 68 },
  level:    { label: 'Level menu',    desc: 'A1–C2 menu', width: 48, builtin: true },
  reports:  { label: 'Reports',       desc: 'Files from the student’s reports folder + notes', width: 82, builtin: true }
};
const NEW_COLUMN_TYPES = ['list', 'file', 'listfile', 'counter'];

const DEFAULT_COLUMNS = [
  { id: 'level', label: 'Level', type: 'level', textKey: 'level' },
  { id: 'needs', label: 'Needs', type: 'list', textKey: 'needs' },
  { id: 'recurringMistakes', label: 'Recurring mistakes', type: 'list', textKey: 'recurringMistakes' },
  { id: 'vocabLearned', label: 'Vocabulary (learned)', type: 'list', textKey: 'vocabLearned' },
  { id: 'vocabToLearn', label: 'Vocabulary (to be learned)', type: 'list', textKey: 'vocabToLearn' },
  { id: 'grammarCovered', label: 'Grammar covered', type: 'list', textKey: 'grammarCovered' },
  { id: 'conversation', label: 'Conversation', type: 'list', textKey: 'conversation' },
  { id: 'homework', label: 'Homework', type: 'list', textKey: 'homework' },
  { id: 'lessonCount', label: 'Lesson count', type: 'counter', countKey: 'lessonCount' },
  { id: 'done', label: 'Done', type: 'listfile', textKey: 'docsText', filesKey: 'docsCompleted' },
  { id: 'todo', label: 'To do', type: 'list', textKey: 'todo' },
  { id: 'reports', label: 'Reports', type: 'reports', textKey: 'reportsText' }
];

function makeColumn(label, type) {
  const id = 'c' + uid();
  const col = { id, label, type };
  if (type === 'list' || type === 'listfile') col.textKey = `f_${id}_text`;
  if (type === 'file' || type === 'listfile') col.filesKey = `f_${id}_files`;
  if (type === 'counter') col.countKey = `f_${id}_count`;
  return col;
}
const visibleColumns = () => data.settings.columns.filter(c => !c.hidden);

// First start of this version (or an old backup): use the standard columns.
// Returns true if the settings were changed.
function ensureColumns(settings) {
  const ok = Array.isArray(settings.columns) &&
    settings.columns.every(c => c && c.id && c.label && COLUMN_TYPES[c.type]);
  if (ok) return false;
  settings.columns = DEFAULT_COLUMNS.map(c => ({ ...c }));
  return true;
}

// Fields that held plain text in old versions (converted once to formatted text)
const RICH_KEYS = ['needs', 'recurringMistakes', 'vocabLearned', 'vocabToLearn', 'grammarCovered',
  'conversation', 'homework', 'todo', 'docsText', 'reportsText'];

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const COLOR_SWATCHES = [
  '#3b6ef5', '#2e9d5b', '#d64545', '#e8912d', '#9b51e0',
  '#14a3b8', '#e04f9b', '#7a8394', '#c9a227', '#5c3d2e'
];

const DEFAULT_SETTINGS = {
  bgColor: '#f6f7fb', lineColor: '#d5d9e2', textColor: '#1f2430',
  reportsFolder: '', reportsPattern: '*{name}*',
  backupEnabled: false, backupDestinations: [], backupKeep: 30,
  fontFamily: 'Segoe UI'
};

// ======================================================================
// Helpers
// ======================================================================
const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const baseName = p => p.split(/[\\/]/).pop();
const fmtDate = ms => ms ? new Date(ms).toLocaleDateString() : '';

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

async function persist() {
  try { await window.api.saveData(data); }
  catch (e) { toast('Could not save: ' + e.message); }
}

function getStudent(id) { return data.students.find(s => s.id === id); }

function newStudent(name) {
  return {
    id: uid(), name, color: COLOR_SWATCHES[data.students.length % COLOR_SWATCHES.length],
    personal: {},
    level: '', needs: '', recurringMistakes: '', vocabLearned: '', vocabToLearn: '', grammarCovered: '',
    lessonCount: 0, docsCompleted: [], todo: '',
    createdAt: new Date().toISOString()
  };
}

// Older versions stored "to do" as a list of files; turn it into bullet text.
function migrate(s) {
  if (Array.isArray(s.docsTodo)) {
    if (!s.todo && s.docsTodo.length) s.todo = s.docsTodo.map(d => '• ' + baseName(d.path)).join('\n');
    delete s.docsTodo;
  }
  if (typeof s.todo !== 'string') s.todo = '';
  if (!Array.isArray(s.docsCompleted)) s.docsCompleted = [];
  if (typeof s.docsText !== 'string') s.docsText = '';
  if (typeof s.reportsText !== 'string') s.reportsText = '';
  if (typeof s.conversation !== 'string') s.conversation = '';
  if (typeof s.homework !== 'string') s.homework = '';
  // Older versions stored plain text; convert once to formatted text (HTML)
  if (!s.rich) {
    for (const k of RICH_KEYS) s[k] = plainToHtml(s[k] || '');
    if (s.personal && s.personal.notes) s.personal.notes = plainToHtml(s.personal.notes);
    s.rich = true;
    migrated = true;
  }
}
let migrated = false;

// A block of stored formatted text, ready to display
function richNode(html, cls = '') {
  const d = el('div', { class: 'rich ' + cls });
  d.innerHTML = sanitizeHtml(html);
  return d;
}

// Row colors are mixed with plain white (not with the app background), so a
// student's color looks the same whatever the app colors are. Text color is
// picked automatically (dark or light) for readability.
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixWhite(rgb, amount) {
  return rgb.map(c => Math.round(c * amount + 255 * (1 - amount)));
}
const rgbCss = c => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
function luminance([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function rowColors(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const bg = mixWhite(rgb, 0.42), hover = mixWhite(rgb, 0.55);
  const fg = luminance(bg) > 0.4 ? '#1f2430' : '#ffffff';
  return { bg: rgbCss(bg), hover: rgbCss(hover), fg };
}

// ======================================================================
// Theme
// ======================================================================
function applyTheme() {
  const s = data.settings;
  const root = document.documentElement.style;
  root.setProperty('--bg', s.bgColor || DEFAULT_SETTINGS.bgColor);
  root.setProperty('--line', s.lineColor || DEFAULT_SETTINGS.lineColor);
  root.setProperty('--text', s.textColor || DEFAULT_SETTINGS.textColor);
  root.setProperty('--font', `"${(s.fontFamily || DEFAULT_SETTINGS.fontFamily).replace(/"/g, '')}", "Segoe UI", system-ui, sans-serif`);
}

// Fonts that come with Windows
const FONTS = ['Segoe UI', 'Arial', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Century Gothic',
  'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Franklin Gothic Medium', 'Garamond', 'Georgia',
  'Lucida Sans Unicode', 'Palatino Linotype', 'Segoe Print', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

// ======================================================================
// Table rendering
// ======================================================================
function matchesSearch(s) {
  if (!searchTerm) return true;
  const hay = [s.name, ...Object.values(s.personal || {}).map(htmlToText)].join(' \u0001 ').toLowerCase();
  return searchTerm.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
}

function renderHeader() {
  const cols = visibleColumns();
  const tr = $('#headRow');
  tr.innerHTML = '';
  tr.append(el('th', { class: 'col-name' }, 'Name'));
  let fixed = 140, auto = 0;
  for (const c of cols) {
    const w = (COLUMN_TYPES[c.type] || {}).width;
    const th = el('th', { 'data-col': c.id, class: 'th-' + c.type, title: c.label }, c.label);
    if (w) { th.style.width = w + 'px'; fixed += w; } else auto++;
    tr.append(th);
  }
  // below this width the table scrolls sideways instead of squeezing text columns
  $('#grid').style.minWidth = (fixed + auto * 85) + 'px';
}

function render() {
  closePopover(false);
  renderHeader();
  const body = $('#gridBody');
  body.innerHTML = '';
  const list = data.students
    .filter(matchesSearch)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  for (const s of list) body.append(renderRow(s));

  const empty = $('#emptyState');
  if (data.students.length === 0) {
    empty.textContent = 'No students yet. Click “+ Add student” to get started.';
    empty.classList.remove('hidden');
  } else if (list.length === 0) {
    empty.textContent = 'No students match your search.';
    empty.classList.remove('hidden');
  } else empty.classList.add('hidden');

  $('#studentCount').textContent =
    `${list.length === data.students.length ? '' : list.length + ' of '}${data.students.length} student${data.students.length === 1 ? '' : 's'}`;
}

function rowOf(s) { return document.querySelector(`tr[data-id="${s.id}"]`); }
const cellOf = (s, colId) => rowOf(s) && rowOf(s).querySelector(`td[data-col="${colId}"]`);
const colById = id => data.settings.columns.find(c => c.id === id);

function rerenderRow(s) {
  const tr = rowOf(s);
  const fresh = renderRow(s);
  if (tr) tr.replaceWith(fresh);
  return fresh;
}

function rerenderCell(s, col) {
  const c = cellOf(s, col.id);
  if (c) c.replaceWith(renderCell(s, col));
}

function renderRow(s) {
  const tr = el('tr', { 'data-id': s.id });
  const rc = rowColors(s.color);
  if (rc) {
    tr.classList.add('colored');
    tr.style.setProperty('--row-bg', rc.bg);
    tr.style.setProperty('--row-bg-hover', rc.hover);
    tr.style.setProperty('--row-fg', rc.fg);
  }

  // Name (always first)
  const nameTd = el('td', { class: 'col-name' });
  nameTd.append(el('div', { class: 'name-cell', title: 'Show personal details' },
    el('span', { class: 'color-dot', style: { background: s.color || '#ccc' } }),
    el('span', {}, s.name)));
  nameTd.addEventListener('click', () => toggleDropdown(nameTd, () => openNameDropdown(s, nameTd)));
  tr.append(nameTd);

  for (const col of visibleColumns()) tr.append(renderCell(s, col));
  return tr;
}

function renderCell(s, col) {
  switch (col.type) {
    case 'counter': return renderCountCell(s, col);
    case 'file': case 'listfile': case 'reports': return renderFileCell(s, col);
    default: return renderTextCell(s, col); // list, level
  }
}

function renderTextCell(s, col) {
  const isLevel = col.type === 'level';
  const val = s[col.textKey] || '';
  const td = el('td', { 'data-col': col.id });
  const content = !val
    ? el('div', { class: 'clamp' }, el('span', { class: 'muted' }, '—'))
    : isLevel ? el('div', { class: 'clamp' }, val) : richNode(val, 'clamp');
  td.append(el('div', { class: 'text-cell', title: (isLevel ? val : htmlToText(val)) || 'Click to edit' }, content));
  td.addEventListener('click', () => toggleDropdown(td, () =>
    isLevel ? openLevelDropdown(s, col, td) : openTextDropdown(s, col, td)));
  return td;
}

function renderCountCell(s, col) {
  const td = el('td', { class: 'count-cell', 'data-col': col.id });
  const key = `${s.id}|${col.id}`;
  if (editingCount === key) {
    const valueEl = el('span', { class: 'count-value' }, pendingCount);
    const set = v => { pendingCount = Math.max(0, v); valueEl.textContent = pendingCount; };
    td.append(el('div', { class: 'count-edit' },
      el('div', { class: 'count-row' },
        el('button', { class: 'round-btn', title: 'Minus one', onclick: () => set(pendingCount - 1) }, '−'),
        valueEl,
        el('button', { class: 'round-btn', title: 'Plus one', onclick: () => set(pendingCount + 1) }, '+')
      ),
      el('div', { class: 'count-row' },
        el('button', {
          class: 'btn primary small', onclick: async () => {
            s[col.countKey] = pendingCount;
            editingCount = null;
            await persist();
            rerenderCell(s, col);
            toast(`${col.label} saved for ${s.name}`);
          }
        }, 'Save'),
        el('button', {
          class: 'icon-btn', title: 'Cancel', onclick: () => { editingCount = null; rerenderCell(s, col); }
        }, '✕')
      )
    ));
  } else {
    td.append(el('span', {
      class: 'count-number', title: 'Click to change',
      onclick: () => {
        closePopover(true);
        if (editingCount && editingCount !== key) { // close the other open counter
          const [sid, cid] = editingCount.split('|');
          editingCount = null;
          const os = getStudent(sid), oc = colById(cid);
          if (os && oc) rerenderCell(os, oc);
        }
        editingCount = key;
        pendingCount = s[col.countKey] || 0;
        rerenderCell(s, col);
      }
    }, s[col.countKey] || 0));
  }
  return td;
}

// Cell for file columns and Reports: a file-count chip and (if the column
// has notes) the first lines of the text; click opens files + notes below.
function renderFileCell(s, col) {
  const isReports = col.type === 'reports';
  const count = isReports ? (reportsCache[s.id] || []).length : (s[col.filesKey] || []).length;
  const val = col.textKey ? (s[col.textKey] || '') : '';
  const label = isReports ? (count === 1 ? 'report' : 'reports') : (count === 1 ? 'file' : 'files');
  const td = el('td', { class: 'file-cell', 'data-col': col.id });
  td.append(el('div', { class: 'text-cell', title: `${count} ${label}` + (val ? ' · ' + htmlToText(val) : '') },
    el('div', { class: 'doc-chip' + (count ? ' has' : '') }, `${isReports ? '📊' : '📎'} ${count}`),
    val ? richNode(val, 'clamp clamp-2') : null));
  td.addEventListener('click', () => toggleDropdown(td, () =>
    isReports ? openReportsDropdown(s, col, td) : openDocsDropdown(s, col, td)));
  return td;
}

// ======================================================================
// Dropdown (one at a time, always opens DOWN below its cell, floats over the
// table like a context menu – the cell / row never changes size)
// ======================================================================
let pop = { anchor: null, onClose: null };

function toggleDropdown(anchor, open) {
  if (pop.anchor === anchor) { closePopover(true); return; }
  closePopover(true);
  open();
}

function closePopover(save = true) {
  const p = $('#popover');
  const { anchor, onClose } = pop;
  pop = { anchor: null, onClose: null };
  p.classList.add('hidden');
  p.innerHTML = '';
  if (anchor) anchor.classList.remove('active-cell');
  if (onClose) onClose(save);
}

function showDropdown(anchor, nodes, { width = 380, onClose = null } = {}) {
  const p = $('#popover');
  p.innerHTML = '';
  p.append(...nodes);
  pop = { anchor, onClose };
  anchor.classList.add('active-cell');
  placeDropdown(anchor, width);
}

function placeDropdown(anchor, width) {
  const p = $('#popover');
  const r = anchor.getBoundingClientRect();
  const w = Math.min(Math.max(width, r.width), window.innerWidth - 20);
  p.style.width = w + 'px';
  p.style.left = Math.max(10, Math.min(r.left, window.innerWidth - w - 10)) + 'px';
  // Measure the popover's natural height (capped by the CSS max-height).
  p.style.top = '0px';
  p.style.bottom = 'auto';
  p.style.maxHeight = '';
  p.classList.remove('hidden');
  const want = p.offsetHeight;
  const below = window.innerHeight - r.bottom - 10;
  const above = r.top - 10;
  // Open below if it fits there; otherwise above if it fits (or has more room).
  if (want <= below || below >= above) {
    p.style.top = (r.bottom - 1) + 'px';
    p.style.maxHeight = Math.max(160, below + 1) + 'px';
  } else {
    // Anchor by the bottom edge so the popover grows upward, away from the cell.
    p.style.top = 'auto';
    p.style.bottom = (window.innerHeight - r.top - 1) + 'px';
    p.style.maxHeight = Math.max(160, above + 1) + 'px';
  }
}

function popHead(title) {
  return el('div', { class: 'pop-head' }, el('strong', {}, title),
    el('button', { class: 'icon-btn', title: 'Close', onclick: () => closePopover(true) }, '✕'));
}

document.addEventListener('mousedown', e => {
  const p = $('#popover');
  if (p.classList.contains('hidden')) return;
  if (p.contains(e.target) || (pop.anchor && pop.anchor.contains(e.target))) return;
  closePopover(true);
});
window.addEventListener('resize', () => closePopover(true));
$('.table-wrap').addEventListener('scroll', () => {
  if (pop.anchor && !$('#popover').classList.contains('hidden')) placeDropdown(pop.anchor, $('#popover').offsetWidth);
});

// ---------- Rich text: sanitizing, converting, editing ----------
// Only these tags/attributes survive; everything else (scripts, pasted
// styles, links…) is removed, so stored text is always safe to display.
const RT_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SPAN', 'FONT']);
const RT_STYLE_OK = /^(color|background-color|font-weight|font-style|text-decoration(-line)?)$/i;

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const clean = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE || !RT_TAGS.has(child.tagName)) {
        if (child.nodeType === Node.ELEMENT_NODE && !/^(SCRIPT|STYLE|IFRAME|OBJECT)$/.test(child.tagName)) {
          clean(child);
          child.replaceWith(...child.childNodes); // keep the text, drop the tag
        } else child.remove();
        continue;
      }
      // FONT (from the color command) -> SPAN with a color style
      let elx = child;
      if (child.tagName === 'FONT') {
        elx = document.createElement('span');
        if (child.getAttribute('color')) elx.style.color = child.getAttribute('color');
        elx.append(...child.childNodes);
        child.replaceWith(elx);
      }
      const keepStart = elx.tagName === 'OL' && /^\d+$/.test(elx.getAttribute('start') || '') ? elx.getAttribute('start') : null;
      const style = elx.getAttribute('style') || '';
      for (const a of [...elx.attributes]) elx.removeAttribute(a.name);
      if (keepStart) elx.setAttribute('start', keepStart);
      if (style && elx.tagName === 'SPAN') {
        const kept = style.split(';').map(x => x.trim()).filter(x => {
          const [k, v] = x.split(':').map(y => (y || '').trim());
          return k && v && RT_STYLE_OK.test(k) && !/url\(|expression/i.test(v);
        });
        if (kept.length) elx.setAttribute('style', kept.join('; '));
      }
      clean(elx);
    }
  };
  const root = doc.body.firstChild;
  clean(root);
  const out = root.innerHTML;
  return htmlToText(out).trim() === '' && !/<li/i.test(out) ? '' : out;
}

function htmlToText(html) {
  const d = document.createElement('div');
  d.innerHTML = (html || '').replace(/<(br|\/div|\/p|\/li)>/gi, '$& ');
  return d.textContent || '';
}

const escHtml = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Plain text from older versions ("• item", "1. item" lines) -> HTML lists
function plainToHtml(text) {
  if (!text) return '';
  const out = [];
  let list = null; // { type, items, start }
  const flush = () => {
    if (!list) return;
    const start = list.type === 'ol' && list.start !== 1 ? ` start="${list.start}"` : '';
    out.push(`<${list.type}${start}>${list.items.map(i => `<li>${i || '<br>'}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  for (const line of text.split('\n')) {
    let m;
    if ((m = line.match(/^[•\-] (.*)$/))) {
      if (!list || list.type !== 'ul') { flush(); list = { type: 'ul', items: [] }; }
      list.items.push(escHtml(m[1]));
    } else if ((m = line.match(/^(\d+)\. (.*)$/))) {
      if (!list || list.type !== 'ol') { flush(); list = { type: 'ol', items: [], start: parseInt(m[1], 10) }; }
      list.items.push(escHtml(m[2]));
    } else {
      flush();
      out.push(`<div>${line ? escHtml(line) : '<br>'}</div>`);
    }
  }
  flush();
  return out.join('');
}

const RT_COLORS = ['#1f2430', '#d64545', '#e8912d', '#c9a227', '#2e9d5b', '#14a3b8', '#3b6ef5', '#9b51e0'];
const RT_HIGHLIGHTS = ['#fff59d', '#ffd8a8', '#ffc9c9', '#c3fae8', '#d0ebff', '#e5dbff'];

// True when nothing visible comes before `node` on its line: the line starts
// at the editor's start, after a line break, or after a block (div, list…).
const RT_BLOCKS = /^(DIV|P|UL|OL|LI|BR)$/;
function isLineStart(node, root) {
  let n = node;
  while (n && n !== root) {
    let prev = n.previousSibling;
    while (prev && prev.nodeType === Node.TEXT_NODE && prev.data === '') prev = prev.previousSibling;
    if (prev) return RT_BLOCKS.test(prev.nodeName) || /\n$/.test(prev.textContent);
    n = n.parentNode;                       // first in its parent: look at the parent
    if (n && n !== root && /^(DIV|P|LI)$/.test(n.nodeName)) return true;
  }
  return true;
}

function placeCaret(node, atEnd = false) {
  const r = document.createRange();
  if (node.firstChild && node.firstChild.nodeType === Node.TEXT_NODE) r.setStart(node.firstChild, atEnd ? node.firstChild.length : 0);
  else r.setStart(node, 0);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
}

// Moves a nested list item one level out; the items that were below it in
// the same sub-list become its own sub-items.
function outdentItem(li) {
  const sub = li.parentElement;          // UL/OL inside the parent item
  const parentLi = sub.parentElement;    // LI one level up
  const after = [];
  for (let n = li.nextElementSibling; n; n = n.nextElementSibling) after.push(n);
  if (after.length) {
    const rest = document.createElement(sub.tagName);
    rest.append(...after);
    li.append(rest);
  }
  parentLi.after(li);
  if (!sub.children.length) sub.remove();
  placeCaret(li);
}

// Creates a formatted-text editor: toolbar + editable area.
//   "- " at the start of a line -> bullet list, "1. " -> numbered list
//   Enter adds a new list item (also after an empty one)
//   Backspace at the start of an item ends the list for that line
function createRichEditor(html, { placeholder = 'Type here…', minHeight = 160, onSubmit } = {}) {
  const ed = el('div', { class: 'rte', contenteditable: 'true', 'data-placeholder': placeholder, spellcheck: 'true' });
  ed.style.minHeight = minHeight + 'px';
  ed.innerHTML = sanitizeHtml(html);
  document.execCommand('styleWithCSS', false, true);

  const cmd = (name, value = null) => { ed.focus(); document.execCommand(name, false, value); updateState(); };
  const btn = (label, title, onClick, cls = '') => el('button', {
    class: 'rte-btn ' + cls, title, type: 'button',
    onmousedown: e => e.preventDefault(), // keep the text selection
    onclick: onClick
  }, label);

  const palette = (colors, command, title, label) => {
    const wrap = el('span', { class: 'rte-pal-wrap' });
    const menu = el('div', { class: 'rte-pal hidden' },
      colors.map(c => el('span', {
        class: 'rte-swatch', style: { background: c }, title: c,
        onmousedown: e => { e.preventDefault(); cmd(command, c); menu.classList.add('hidden'); }
      })),
      el('span', {
        class: 'rte-swatch rte-none', title: 'None',
        onmousedown: e => {
          e.preventDefault();
          cmd(command, command === 'hiliteColor' ? 'transparent' : RT_COLORS[0]);
          menu.classList.add('hidden');
        }
      }, '✕'));
    wrap.append(btn(label, title, () => menu.classList.toggle('hidden')), menu);
    return wrap;
  };

  const bBold = btn('B', 'Bold (Ctrl+B)', () => cmd('bold'), 'b');
  const bItalic = btn('I', 'Italic (Ctrl+I)', () => cmd('italic'), 'i');
  const bUnder = btn('U', 'Underline (Ctrl+U)', () => cmd('underline'), 'u');
  const bStrike = btn('S', 'Strikethrough', () => cmd('strikeThrough'), 's');
  const bUl = btn('• ≡', 'Bulleted list ("- ")', () => cmd('insertUnorderedList'));
  const bOl = btn('1. ≡', 'Numbered list ("1. ")', () => cmd('insertOrderedList'));

  const toolbar = el('div', { class: 'rte-toolbar' },
    bBold, bItalic, bUnder, bStrike,
    el('span', { class: 'rte-sep' }),
    palette(RT_COLORS, 'foreColor', 'Text color', el('span', { class: 'rte-a' }, 'A')),
    palette(RT_HIGHLIGHTS, 'hiliteColor', 'Highlight', el('span', { class: 'rte-hl' }, 'ab')),
    el('span', { class: 'rte-sep' }),
    bUl, bOl,
    el('span', { class: 'rte-sep' }),
    btn('Tx', 'Clear formatting', () => cmd('removeFormat'))
  );

  function updateState() {
    const q = c => { try { return document.queryCommandState(c); } catch { return false; } };
    bBold.classList.toggle('on', q('bold'));
    bItalic.classList.toggle('on', q('italic'));
    bUnder.classList.toggle('on', q('underline'));
    bStrike.classList.toggle('on', q('strikeThrough'));
    bUl.classList.toggle('on', q('insertUnorderedList'));
    bOl.classList.toggle('on', q('insertOrderedList'));
  }
  document.addEventListener('selectionchange', () => { if (ed.isConnected && document.activeElement === ed) updateState(); });

  const caretInfo = () => {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    let node = range.startContainer;
    if (!ed.contains(node)) return null;
    const li = (node.nodeType === 1 ? node : node.parentElement).closest('li');
    // block = the line the caret is on (direct child of the editor, or the editor itself)
    let block = node;
    while (block && block.parentNode !== ed && block !== ed) block = block.parentNode;
    const startOf = container => {
      const r = document.createRange();
      r.selectNodeContents(container);
      r.setEnd(range.startContainer, range.startOffset);
      return r.toString();
    };
    return { sel, range, li: li && ed.contains(li) ? li : null, block, before: block === ed ? null : startOf(block), beforeInLi: li ? startOf(li) : null };
  };

  // "- " / "1. " typed at the start of a line -> list
  ed.addEventListener('input', e => {
    if (!/^insert(Text|ReplacementText|CompositionText)$/.test(e.inputType)) return;
    const c = caretInfo();
    if (!c || c.li) return;
    // the text the caret is in must start the line it is on (whatever is
    // written above: plain text, a list, bold text…)
    const first = c.range.startContainer;
    if (first.nodeType !== Node.TEXT_NODE || !isLineStart(first, ed)) return;
    const m = first.data.replace(/ /g, ' ').match(/^(?:([-•])|(\d+)\.) /);
    if (!m) return;
    const bullet = !!m[1];
    const num = bullet ? null : [null, m[2]];
    const caretInFirst = c.range.startContainer === first ? c.range.startOffset : null;
    if (caretInFirst !== null && caretInFirst < m[0].length) return; // still typing the marker
    const restAfter = caretInFirst !== null ? first.data.length - caretInFirst : 0;
    // select the marker and delete it with the editor's own command
    const r = document.createRange();
    r.setStart(first, 0); r.setEnd(first, m[0].length);
    c.sel.removeAllRanges(); c.sel.addRange(r);
    document.execCommand('delete');
    document.execCommand(bullet ? 'insertUnorderedList' : 'insertOrderedList');
    // put the caret back where the user was typing (end of the item, minus text after the caret)
    const s2 = window.getSelection();
    s2.modify('move', 'forward', 'lineboundary');
    for (let i = 0; i < restAfter; i++) s2.modify('move', 'backward', 'character');
    const c2 = caretInfo();
    const newList = c2 && c2.li && c2.li.parentElement;
    if (newList) {
      // a list created inside bold/colored text must not inherit that formatting:
      // move it out of the surrounding inline element(s)
      let moved = false;
      while (newList.parentElement && newList.parentElement !== ed && /^(SPAN|B|STRONG|I|EM|U|S|STRIKE|FONT)$/.test(newList.parentElement.nodeName)) {
        newList.parentElement.after(newList);
        moved = true;
      }
      if (num && num[1] !== '1' && newList.tagName === 'OL') newList.setAttribute('start', num[1]);
      if (moved) placeCaret(c2.li, true);
    }
    updateState();
  });

  ed.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); if (onSubmit) onSubmit(); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const c = caretInfo();
    if (!c || !c.li) return;

    // Enter on an empty item: still add a new item (browsers would end the list)
    if (e.key === 'Enter' && !e.shiftKey && c.li.textContent === '' && !c.li.querySelector('li')) {
      e.preventDefault();
      const li = document.createElement('li');
      li.innerHTML = '<br>';
      c.li.after(li);
      const r = document.createRange();
      r.setStart(li, 0); r.collapse(true);
      c.sel.removeAllRanges(); c.sel.addRange(r);
      return;
    }

    const isEmptyItem = c.li.textContent === '' && !c.li.querySelector('ul, ol');
    const nested = c.li.parentElement.parentElement && c.li.parentElement.parentElement.tagName === 'LI';

    // → on an empty item: move it one level in (a bullet under the bullet above)
    if (e.key === 'ArrowRight' && !e.shiftKey && isEmptyItem) {
      const prev = c.li.previousElementSibling;
      if (prev && prev.tagName === 'LI') {
        e.preventDefault();
        const type = c.li.parentElement.tagName;
        let sub = [...prev.children].reverse().find(x => x.tagName === type);
        if (!sub) { sub = document.createElement(type); prev.append(sub); }
        sub.append(c.li);
        placeCaret(c.li);
      }
      return;
    }

    // ← on an empty nested item, or Backspace at the start of a nested item:
    // move it one level out
    if (nested && ((e.key === 'ArrowLeft' && !e.shiftKey && isEmptyItem) || (e.key === 'Backspace' && c.beforeInLi === ''))) {
      e.preventDefault();
      outdentItem(c.li);
      return;
    }

    // Backspace at the very start of an item: end the list for this line
    if (e.key === 'Backspace' && c.beforeInLi === '') {
      e.preventDefault();
      const list = c.li.parentElement;
      const isOl = list.tagName === 'OL';
      const startNum = parseInt(list.getAttribute('start') || '1', 10);
      const indexInList = [...list.children].indexOf(c.li);
      document.execCommand(isOl ? 'insertOrderedList' : 'insertUnorderedList');
      // keep numbering of the items below continuous (e.g. 1, [text], 2, 3)
      if (isOl) {
        const c2 = caretInfo();
        let blk = c2 && c2.block;
        const next = blk && blk.nextElementSibling;
        if (next && next.tagName === 'OL' && indexInList > 0) next.setAttribute('start', String(startNum + indexInList));
      }
      updateState();
    }
  });

  // paste as plain text (keeps the stored text clean)
  ed.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  const wrap = el('div', { class: 'rte-wrap' }, toolbar, ed);
  return {
    node: wrap,
    editor: ed,
    getHtml: () => sanitizeHtml(ed.innerHTML),
    focus: () => {
      ed.focus();
      const r = document.createRange();
      r.selectNodeContents(ed); r.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
  };
}

function openTextDropdown(s, col, td) {
  const original = s[col.textKey] || '';
  const rte = createRichEditor(original, { onSubmit: () => closePopover(true) });

  showDropdown(td, [
    popHead(`${col.label} · ${s.name}`),
    rte.node,
    el('div', { class: 'pop-foot' },
      el('span', { class: 'dd-hint' }, '"- " bullets · "1. " numbers · Backspace ends list · Ctrl+Enter save · Esc cancel'),
      el('button', { class: 'btn small', onclick: () => closePopover(false) }, 'Cancel'),
      el('button', { class: 'btn primary small', onclick: () => closePopover(true) }, 'Save'))
  ], {
    width: 440,
    onClose: async save => {
      const v = rte.getHtml();
      if (!save || v === original) return;
      s[col.textKey] = v;
      await persist();
      rerenderCell(s, col);
    }
  });
  rte.focus();
}

// ---------- Level menu ----------
function openLevelDropdown(s, col, td) {
  const cur = s[col.textKey] || '';
  const setLevel = async v => {
    s[col.textKey] = v;
    closePopover(false);
    await persist();
    rerenderCell(s, col);
  };
  const custom = el('input', { type: 'text', placeholder: 'Other (e.g. B1+)…', value: LEVELS.includes(cur) ? '' : cur, style: { width: '100%' } });
  custom.addEventListener('keydown', e => { if (e.key === 'Enter') setLevel(custom.value.trim()); });

  showDropdown(td, [
    el('div', { class: 'pop-body', style: { padding: '6px' } },
      LEVELS.map(l => el('button', { class: 'menu-item' + (cur === l ? ' selected' : ''), onclick: () => setLevel(l) }, l)),
      el('div', { class: 'menu-sep' }),
      el('div', { style: { padding: '4px 6px' } }, custom),
      el('div', { class: 'menu-sep' }),
      el('button', { class: 'menu-item muted', onclick: () => setLevel('') }, 'Clear level'))
  ], { width: 180 });
}

// ---------- Name: personal details (view / edit) ----------
function openNameDropdown(s, td) {
  const p = s.personal || {};
  const grid = el('div', { class: 'info-grid' });
  // counters and level menus from the current columns
  for (const c of visibleColumns()) {
    if (c.type === 'counter') grid.append(el('div', { class: 'label' }, c.label), el('div', { class: 'value' }, s[c.countKey] || 0));
    if (c.type === 'level') grid.append(el('div', { class: 'label' }, c.label), el('div', { class: 'value' }, s[c.textKey] || '—'));
  }
  grid.append(el('div', { class: 'label' }, 'Reports folder'), el('div', { class: 'value' },
    s.reportsFolder
      ? el('a', { onclick: () => window.api.openFile(s.reportsFolder), title: 'Open folder' }, s.reportsFolder)
      : el('span', { class: 'muted' }, '— (set it with Edit)')));
  for (const f of PERSONAL_FIELDS) {
    const v = p[f.key];
    let valueNode;
    if (!v) valueNode = el('span', { class: 'muted' }, '—');
    else if (f.key === 'preplyLink' && /^https?:\/\//i.test(v)) valueNode = el('a', { onclick: () => window.open(v) }, v);
    else if (f.key === 'email') valueNode = el('a', { onclick: () => window.open('mailto:' + v) }, v);
    else if (f.type === 'date') valueNode = new Date(v).toLocaleDateString();
    else if (f.type === 'textarea') valueNode = richNode(v);
    else valueNode = v;
    grid.append(el('div', { class: 'label' }, f.label), el('div', { class: 'value' }, valueNode));
  }

  showDropdown(td, [
    popHead(s.name),
    el('div', { class: 'pop-body' }, grid),
    el('div', { class: 'pop-foot' },
      el('button', { class: 'btn primary small', onclick: () => openNameEdit(s, td) }, '✎ Edit'))
  ], { width: 440 });
}

function openNameEdit(s, td) {
  const form = buildStudentForm(s, false, {
    onSave: async () => {
      await persist();
      await scanAllReports();
      closePopover(false);
      const fresh = rerenderRow(s);
      const nameTd = fresh.querySelector('td.col-name');
      openNameDropdown(s, nameTd);
      toast('Saved');
    },
    onCancel: () => { closePopover(false); openNameDropdown(s, rowOf(s).querySelector('td.col-name')); },
    onDelete: async () => {
      closePopover(false);
      data.students = data.students.filter(o => o.id !== s.id);
      await persist();
      render();
      toast(`${s.name} deleted`);
    }
  });
  closePopover(false);
  showDropdown(td, [popHead(`Edit · ${s.name}`), el('div', { class: 'pop-body' }, form.body), form.foot], { width: 460 });
  form.focus();
}

function colorPicker(initial) {
  let value = initial || COLOR_SWATCHES[0];
  const wrap = el('div', { class: 'swatches' });
  const custom = el('input', { type: 'color', value, title: 'Custom color' });
  const draw = () => {
    wrap.querySelectorAll('.swatch').forEach(sw => sw.classList.toggle('selected', sw.dataset.c === value));
    custom.value = value;
  };
  COLOR_SWATCHES.forEach(c => {
    wrap.append(el('span', {
      class: 'swatch', 'data-c': c, style: { background: c }, title: c,
      onclick: () => { value = c; draw(); }
    }));
  });
  custom.addEventListener('input', () => { value = custom.value; draw(); });
  wrap.append(custom);
  draw();
  return { node: wrap, get: () => value };
}

// Shared form for "Add student" (modal) and "Edit" (dropdown)
function buildStudentForm(s, isNew, { onSave, onCancel, onDelete }) {
  const p = s.personal || {};
  const inputs = {};
  const nameInput = el('input', { type: 'text', value: s.name, placeholder: 'Full name' });
  const picker = colorPicker(s.color);

  // This student's own reports folder
  let reportsFolder = s.reportsFolder || '';
  const folderInput = el('input', { type: 'text', value: reportsFolder, placeholder: 'No folder selected', readonly: true, title: reportsFolder });
  const folderRow = el('div', { class: 'row' }, folderInput,
    el('button', {
      class: 'btn small', onclick: async () => {
        const f = await window.api.pickAnyFolder(`Reports folder for ${nameInput.value.trim() || 'this student'}`);
        if (f) { reportsFolder = f; folderInput.value = f; folderInput.title = f; }
      }
    }, 'Browse…'),
    el('button', { class: 'icon-btn', title: 'Clear folder', onclick: () => { reportsFolder = ''; folderInput.value = ''; folderInput.title = ''; } }, '✕'));

  const body = el('div', { class: 'form-grid' },
    el('label', {}, 'Name *'), nameInput,
    el('label', {}, 'Row color'), picker.node,
    el('label', {}, 'Reports folder'), folderRow
  );
  for (const f of PERSONAL_FIELDS) {
    if (f.type === 'textarea') {
      const rte = createRichEditor(p[f.key] || '', { placeholder: 'Notes…', minHeight: 80 });
      rte.node.classList.add('rte-form');
      inputs[f.key] = { get value() { return rte.getHtml(); } };
      body.append(el('label', {}, f.label), rte.node);
      continue;
    }
    const input = el('input', { type: f.type, value: p[f.key] || '' });
    inputs[f.key] = input;
    body.append(el('label', {}, f.label), input);
  }

  const save = async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); toast('Name is required'); return; }
    const dupe = data.students.find(o => o.id !== s.id && o.name.toLowerCase() === name.toLowerCase());
    if (dupe) { toast('A student with this name already exists'); nameInput.focus(); return; }
    s.name = name;
    s.color = picker.get();
    s.reportsFolder = reportsFolder;
    s.personal = {};
    for (const f of PERSONAL_FIELDS) {
      const v = inputs[f.key].value.trim();
      if (v) s.personal[f.key] = v;
    }
    await onSave();
  };
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

  const foot = el('div', { class: isNew ? 'modal-foot' : 'pop-foot' });
  if (!isNew) {
    foot.append(el('button', {
      class: 'btn danger small', style: { marginRight: 'auto' }, onclick: () => {
        if (confirm(`Delete ${s.name} and all of their data from the tracker?\n(Your document files on disk are NOT deleted.)`)) onDelete();
      }
    }, '🗑 Delete'));
  }
  const btnCls = isNew ? 'btn' : 'btn small';
  const right = el('div', { class: 'right', style: { display: 'flex', gap: '8px', marginLeft: 'auto' } },
    el('button', { class: btnCls, onclick: onCancel }, 'Cancel'),
    el('button', { class: btnCls + ' primary', onclick: save }, isNew ? 'Add student' : 'Save'));
  foot.append(right);

  return { body, foot, focus: () => nameInput.focus() };
}

// ---------- Text box shown inside the file dropdowns ----------
function noteEditor(s, key) {
  const rte = createRichEditor(s[key] || '', {
    placeholder: 'Notes…  "- " bullets · "1. " numbers', minHeight: 90, onSubmit: () => closePopover(true)
  });
  rte.node.classList.add('rte-note');
  // writes the text into the student (returns true if it changed)
  const commit = () => {
    const v = rte.getHtml();
    if (v === (s[key] || '')) return false;
    s[key] = v;
    return true;
  };
  return { ta: rte.node, commit };
}

// ---------- File columns ("File" and "List and file"): files + Browse (+ notes) ----------
async function openDocsDropdown(s, col, td) {
  const list = s[col.filesKey] || (s[col.filesKey] = []);
  const exists = list.length ? await window.api.filesExist(list.map(d => d.path)) : [];
  const note = col.textKey ? noteEditor(s, col.textKey) : { ta: null, commit: () => false };

  const ul = el('ul', { class: 'pop-list' });
  list.forEach((doc, i) => {
    ul.append(el('li', { class: exists[i] ? '' : 'missing', title: doc.path },
      el('span', { class: 'file-link', onclick: () => openFile(doc.path) }, baseName(doc.path)),
      el('span', { class: 'file-date' }, fmtDate(doc.added)),
      el('button', { class: 'icon-btn', title: 'Show in folder', onclick: () => window.api.revealFile(doc.path) }, '📁'),
      el('button', { class: 'icon-btn', title: 'Remove from list (file is not deleted)', onclick: () => { note.commit(); removeDoc(s, col, i); } }, '✕')
    ));
  });

  showDropdown(td, [
    popHead(`${col.label} · ${s.name}`),
    list.length ? ul : el('div', { class: 'pop-empty' }, 'No documents yet.'),
    note.ta ? el('div', { class: 'pop-label' }, 'Notes') : null,
    note.ta,
    el('div', { class: 'pop-foot' },
      el('button', { class: 'btn small', style: { marginRight: 'auto' }, onclick: () => { note.commit(); browseDocs(s, col); } }, '📂 Browse…'),
      note.ta ? el('button', { class: 'btn small', onclick: () => closePopover(false) }, 'Cancel') : null,
      el('button', { class: 'btn primary small', onclick: () => closePopover(true) }, note.ta ? 'Save' : 'Close'))
  ], {
    width: 400,
    onClose: async save => {
      if (!save || !note.commit()) return;
      await persist();
      rerenderCell(s, col);
    }
  });
}

async function reopenDocs(s, col) {
  await persist();
  closePopover(false);
  rerenderCell(s, col);
  await openDocsDropdown(s, col, cellOf(s, col.id));
}

async function browseDocs(s, col) {
  const paths = await window.api.pickFiles();
  const list = s[col.filesKey] || (s[col.filesKey] = []);
  let added = 0;
  for (const p of paths) {
    if (!list.some(d => d.path.toLowerCase() === p.toLowerCase())) {
      list.push({ path: p, added: Date.now() });
      added++;
    }
  }
  if (paths.length) toast(added ? `Added ${added} document${added > 1 ? 's' : ''}` : 'Already in the list');
  await reopenDocs(s, col);
}

async function removeDoc(s, col, i) {
  s[col.filesKey].splice(i, 1);
  await reopenDocs(s, col);
}

async function openFile(p) {
  const err = await window.api.openFile(p);
  if (err) toast(err);
}

// ---------- Reports: files found in the reports folder + text ----------
// Each student has their own reports folder (set in the student's Edit form);
// every file in it is listed. Students without one fall back to the shared
// folder + file name pattern from Settings.
function reportsSource(s) {
  if (s.reportsFolder) return { folder: s.reportsFolder, own: true };
  if (data.settings.reportsFolder) return { folder: data.settings.reportsFolder, own: false };
  return null;
}

async function scanStudentReports(s) {
  const src = reportsSource(s);
  let reps = [];
  if (src && src.own) reps = (await window.api.listReportsFolder(src.folder)).files;
  else if (src) {
    const res = await window.api.scanReports({ folder: src.folder, pattern: data.settings.reportsPattern, names: [s.name] });
    reps = res[s.name] || [];
  }
  reportsCache[s.id] = reps;
  return reps;
}

async function scanAllReports() {
  reportsCache = {};
  await Promise.all(data.students.map(scanStudentReports));
}

async function openReportsDropdown(s, col, td) {
  const src = reportsSource(s);
  const reportsFolder = src && src.folder;
  const reportsPattern = data.settings.reportsPattern;
  const note = noteEditor(s, col.textKey);
  const reps = await scanStudentReports(s);

  const files = !reportsFolder
    ? el('div', { class: 'pop-empty' }, 'No reports folder for this student yet. ',
        el('a', { href: '#', onclick: e => { e.preventDefault(); closePopover(true); openNameEdit(s, rowOf(s).querySelector('td.col-name')); } }, 'Choose it in the student’s details'))
    : reps.length
      ? el('ul', { class: 'pop-list' },
          reps.map(r => el('li', { title: r.path },
            el('span', { class: 'file-link', onclick: () => openFile(r.path) }, baseName(r.path)),
            el('span', { class: 'file-date' }, fmtDate(r.mtime)),
            el('button', { class: 'icon-btn', title: 'Show in folder', onclick: () => window.api.revealFile(r.path) }, '📁'))))
      : el('div', { class: 'pop-empty' }, 'No files in this folder yet.');

  showDropdown(td, [
    popHead(`${col.label} · ${s.name}`),
    reportsFolder ? el('div', { class: 'pop-sub' },
      src.own ? `Folder: ${reportsFolder}` : `Shared folder: ${reportsFolder} · Pattern: ${reportsPattern || '*{name}*'}`,
      ' · ',
      el('a', { href: '#', onclick: e => { e.preventDefault(); window.api.openFile(reportsFolder); } }, 'Open folder')) : null,
    files,
    el('div', { class: 'pop-label' }, 'Notes'),
    note.ta,
    el('div', { class: 'pop-foot' },
      reportsFolder ? el('button', {
        class: 'btn small', style: { marginRight: 'auto' }, onclick: async () => {
          note.commit();
          await persist();
          closePopover(false);
          rerenderCell(s, col);
          await openReportsDropdown(s, col, cellOf(s, col.id));
        }
      }, '⟳ Refresh') : null,
      el('button', { class: 'btn small', onclick: () => closePopover(false) }, 'Cancel'),
      el('button', { class: 'btn primary small', onclick: () => closePopover(true) }, 'Save'))
  ], {
    width: 400,
    onClose: async save => {
      const changed = save && note.commit();
      if (changed) await persist();
      rerenderCell(s, col); // also refreshes the report count
    }
  });
}

// ======================================================================
// Modal helpers
// ======================================================================
function openModal(...content) {
  closePopover(true);
  const m = $('#modal');
  m.className = 'modal';
  m.innerHTML = '';
  m.append(...content);
  $('#modalBackdrop').classList.remove('hidden');
}
function closeModal() { $('#modalBackdrop').classList.add('hidden'); }
$('#modalBackdrop').addEventListener('mousedown', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#modalBackdrop').classList.contains('hidden')) closeModal();
    else closePopover(false);
  }
});

function openAddStudent() {
  const s = newStudent('');
  const form = buildStudentForm(s, true, {
    onSave: async () => {
      data.students.push(s);
      await persist();
      await scanAllReports();
      render();
      closeModal();
      toast(`${s.name} added`);
    },
    onCancel: closeModal
  });
  openModal(
    el('div', { class: 'modal-head' }, el('h2', {}, 'Add student'),
      el('button', { class: 'icon-btn', onclick: closeModal }, '✕')),
    el('div', { class: 'modal-body' }, form.body),
    form.foot
  );
  form.focus();
}

// ======================================================================
// Edit columns: add, remove (hide), move and rename columns
// ======================================================================
function openColumnsEditor() {
  const body = el('div', { class: 'modal-body' });
  openModal(
    el('div', { class: 'modal-head' }, el('h2', {}, '▦ Edit columns'), el('button', { class: 'icon-btn', onclick: closeModal }, '✕')),
    body,
    el('div', { class: 'modal-foot' },
      el('span', { class: 'muted', style: { fontSize: '12px', alignSelf: 'center' } }, 'Changes are saved right away and are included in backups.'),
      el('div', { class: 'right' }, el('button', { class: 'btn primary', onclick: closeModal }, 'Done')))
  );
  $('#modal').classList.add('modal-wide');
  drawColumnsEditor(body);
}

async function applyColumns(body) {
  await persist();
  render();
  drawColumnsEditor(body);
}

function drawColumnsEditor(body) {
  const all = data.settings.columns;
  const visible = all.filter(c => !c.hidden);
  const hidden = all.filter(c => c.hidden);

  const setOrder = ids => {
    const byId = Object.fromEntries(all.map(c => [c.id, c]));
    data.settings.columns = [...ids.map(id => byId[id]), ...hidden];
  };
  const move = (i, d) => {
    const ids = visible.map(c => c.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids);
    applyColumns(body);
  };

  // --- current columns ---
  let dragId = null;
  const list = el('div', { class: 'col-list' },
    el('div', { class: 'col-row fixed' },
      el('span', { class: 'col-handle' }, ''),
      el('span', { class: 'col-fixed-name' }, 'Name'),
      el('span', { class: 'col-type' }, 'always first'),
      el('span'), el('span'), el('span')),
    visible.map((c, i) => {
      const name = el('input', { type: 'text', value: c.label, title: 'Click to rename' });
      const rename = async () => {
        const v = name.value.trim();
        if (!v) { name.value = c.label; toast('A column needs a name'); return; }
        if (v === c.label) return;
        c.label = v;
        await applyColumns(body);
        toast('Column renamed');
      };
      name.addEventListener('change', rename);
      name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });

      const row = el('div', { class: 'col-row', draggable: 'true', 'data-id': c.id },
        el('span', { class: 'col-handle', title: 'Drag to move' }, '⠿'),
        name,
        el('span', { class: 'col-type', title: (COLUMN_TYPES[c.type] || {}).desc }, (COLUMN_TYPES[c.type] || {}).label),
        el('button', { class: 'icon-btn', title: 'Move left', disabled: i === 0 ? true : null, onclick: () => move(i, -1) }, '↑'),
        el('button', { class: 'icon-btn', title: 'Move right', disabled: i === visible.length - 1 ? true : null, onclick: () => move(i, 1) }, '↓'),
        el('button', {
          class: 'btn small danger', title: 'Hide this column (its data is kept and it can be restored)',
          onclick: async () => { c.hidden = true; await applyColumns(body); toast(`“${c.label}” removed — restore it below if needed`); }
        }, 'Remove'));

      // drag & drop to reorder
      row.addEventListener('dragstart', e => { dragId = c.id; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); list.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target')); });
      row.addEventListener('dragover', e => { if (dragId && dragId !== c.id) { e.preventDefault(); row.classList.add('drop-target'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', e => {
        e.preventDefault();
        if (!dragId || dragId === c.id) return;
        const ids = visible.map(x => x.id).filter(id => id !== dragId);
        ids.splice(ids.indexOf(c.id) + (visible.findIndex(x => x.id === dragId) < i ? 1 : 0), 0, dragId);
        setOrder(ids);
        dragId = null;
        applyColumns(body);
      });
      return row;
    }));

  // --- add a new column ---
  const newName = el('input', { type: 'text', placeholder: 'Column name, e.g. Pronunciation' });
  const newType = el('select', {}, NEW_COLUMN_TYPES.map(t => el('option', { value: t }, COLUMN_TYPES[t].label)));
  const typeDesc = el('div', { class: 'hint', style: { gridColumn: 'auto', marginTop: '4px' } });
  const showDesc = () => { typeDesc.textContent = COLUMN_TYPES[newType.value].desc; };
  newType.addEventListener('change', showDesc);
  showDesc();
  const add = async () => {
    const label = newName.value.trim();
    if (!label) { newName.focus(); toast('Type a name for the new column'); return; }
    data.settings.columns.push(makeColumn(label, newType.value));
    await applyColumns(body);
    toast(`Column “${label}” added`);
  };
  newName.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });

  // --- removed columns ---
  const removed = hidden.length
    ? el('div', { class: 'col-list' }, hidden.map(c => el('div', { class: 'col-row removed' },
        el('span', { class: 'col-handle' }, ''),
        el('span', { class: 'col-fixed-name' }, c.label),
        el('span', { class: 'col-type' }, (COLUMN_TYPES[c.type] || {}).label),
        el('button', {
          class: 'btn small', onclick: async () => {
            delete c.hidden;
            // put it back at the end of the visible columns
            data.settings.columns = [...data.settings.columns.filter(x => !x.hidden && x !== c), c, ...data.settings.columns.filter(x => x.hidden)];
            await applyColumns(body);
            toast(`“${c.label}” restored`);
          }
        }, 'Restore'),
        el('button', {
          class: 'btn small danger', title: 'Delete the column and everything written in it, for all students',
          onclick: async () => {
            if (!confirm(`Delete the column “${c.label}” for good?\n\nEverything written in it (for all students) will be deleted. This cannot be undone.`)) return;
            for (const s of data.students) for (const k of [c.textKey, c.filesKey, c.countKey]) if (k) delete s[k];
            data.settings.columns = data.settings.columns.filter(x => x !== c);
            await applyColumns(body);
            toast(`“${c.label}” deleted`);
          }
        }, 'Delete forever'),
        el('span'))))
    : el('div', { class: 'muted' }, 'None');

  body.innerHTML = '';
  body.append(
    el('div', { class: 'section-title' }, 'Columns (left to right)'),
    el('div', { class: 'hint', style: { marginTop: '-4px', marginBottom: '8px' } },
      'Click a name to rename it. Drag ⠿ or use ↑ ↓ to move. “Remove” hides a column — what was written in it is kept and you can restore it.'),
    list,
    el('div', { class: 'section-title' }, 'Add a column'),
    el('div', { class: 'form-grid' },
      el('label', {}, 'Name'), newName,
      el('label', {}, 'Type'), el('div', {}, newType, typeDesc),
      el('span'), el('div', {}, el('button', { class: 'btn primary small', onclick: add }, '+ Add column'))),
    el('div', { class: 'section-title' }, 'Removed columns'),
    removed
  );
}

// ======================================================================
// Settings
// ======================================================================
async function openSettings() {
  const s = data.settings;
  const version = await window.api.version();
  const dataPath = await window.api.dataPath();

  const colorInput = (key, label) => {
    const code = el('code', {}, s[key]);
    const inp = el('input', { type: 'color', value: s[key] || DEFAULT_SETTINGS[key] });
    inp.addEventListener('input', () => { s[key] = inp.value; code.textContent = inp.value; applyTheme(); });
    inp.addEventListener('change', persist);
    return [el('label', {}, label), el('div', { class: 'color-row' }, inp, code)];
  };

  const folderInput = el('input', { type: 'text', value: s.reportsFolder || '', placeholder: 'No folder selected', readonly: true });
  const patternInput = el('input', { type: 'text', value: s.reportsPattern || '*{name}*' });
  patternInput.addEventListener('change', async () => {
    s.reportsPattern = patternInput.value.trim() || '*{name}*';
    patternInput.value = s.reportsPattern;
    await persist(); await scanAllReports(); render();
  });

  const updateStatus = el('span', { class: 'muted', id: 'settingsUpdateStatus' }, '');
  const backupBox = el('div', {}, el('span', { class: 'muted' }, 'Loading…'));

  openModal(
    el('div', { class: 'modal-head' }, el('h2', {}, '⚙ Settings'), el('button', { class: 'icon-btn', onclick: closeModal }, '✕')),
    el('div', { class: 'modal-body' },
      el('div', { class: 'section-title' }, 'Appearance'),
      el('div', { class: 'form-grid' },
        ...colorInput('bgColor', 'Background color'),
        ...colorInput('lineColor', 'Line color'),
        ...colorInput('textColor', 'Text color'),
        el('label', {}, 'Font'),
        fontSelect(s),
        el('span'),
        el('div', {}, el('button', {
          class: 'btn small', onclick: async () => {
            Object.assign(s, {
              bgColor: DEFAULT_SETTINGS.bgColor, lineColor: DEFAULT_SETTINGS.lineColor,
              textColor: DEFAULT_SETTINGS.textColor, fontFamily: DEFAULT_SETTINGS.fontFamily
            });
            applyTheme(); await persist(); openSettings();
          }
        }, 'Reset colors & font'))
      ),

      el('div', { class: 'section-title' }, 'Reports'),
      el('div', { class: 'form-grid' },
        el('span'),
        el('div', { class: 'hint', style: { gridColumn: 'auto', marginTop: 0 } },
          'Each student has their own reports folder: click the student’s name → Edit → Reports folder › Browse… ' +
          'The shared folder below is optional and only used for students without their own folder.'),
        el('label', {}, 'Shared folder'),
        el('div', { class: 'row' }, folderInput,
          el('button', {
            class: 'btn small', onclick: async () => {
              const f = await window.api.pickFolder();
              if (!f) return;
              s.reportsFolder = f; folderInput.value = f;
              await persist(); await scanAllReports(); render();
              toast('Reports folder set');
            }
          }, 'Browse…')),
        el('label', {}, 'File name pattern'),
        patternInput,
        el('div', { class: 'hint' },
          '{name} = student name, * = anything. Examples: “*{name}*”, “Report - {name} - *”, “{name}_*.pdf”. ' +
          'Spaces in the name also match _ . or -. Subfolders are searched too.')
      ),

      el('div', { class: 'section-title' }, 'Updates'),
      el('div', { class: 'form-grid' },
        el('label', {}, 'Installed version'), el('div', {}, 'v' + version),
        el('span'),
        el('div', { class: 'row' },
          el('button', { class: 'btn small', onclick: () => { updateStatus.textContent = 'Checking…'; window.api.checkUpdate(); } }, 'Check for updates'),
          updateStatus)
      ),

      el('div', { class: 'section-title' }, 'Data'),
      el('div', { class: 'form-grid' },
        el('label', {}, 'Data file'),
        el('div', { class: 'row' }, el('code', { style: { fontSize: '12px', wordBreak: 'break-all' } }, dataPath),
          el('button', { class: 'icon-btn', title: 'Show in folder', onclick: () => window.api.revealFile(dataPath) }, '📁')),
        el('label', {}, 'Manual backup'),
        el('div', { class: 'row' },
          el('button', { class: 'btn small', onclick: async () => { if (await window.api.exportBackup(data)) toast('Backup exported'); } }, 'Export backup…'),
          el('button', {
            class: 'btn small', onclick: async () => {
              try {
                const imp = await window.api.importBackup();
                if (!imp) return;
                if (!Array.isArray(imp.students)) throw new Error('Not a Student Tracker backup');
                if (!confirm(`Replace current data with the backup (${imp.students.length} students)?`)) return;
                data = { students: imp.students, settings: { ...DEFAULT_SETTINGS, ...(imp.settings || {}) } };
                ensureColumns(data.settings);
                data.students.forEach(migrate);
                await persist(); applyTheme(); await scanAllReports(); render(); closeModal();
                toast('Backup imported');
              } catch (e) { toast('Import failed: ' + e.message); }
            }
          }, 'Import backup…'))
      ),

      el('div', { class: 'section-title' }, 'Automatic backup'),
      backupBox
    ),
    el('div', { class: 'modal-foot' }, el('div', { class: 'right' }, el('button', { class: 'btn primary', onclick: closeModal }, 'Done')))
  );
  $('#modal').classList.add('modal-wide');
  renderBackupSection(backupBox);
}

function fontSelect(s) {
  const current = s.fontFamily || DEFAULT_SETTINGS.fontFamily;
  const sel = el('select', { style: { maxWidth: '280px' } },
    FONTS.map(f => el('option', { value: f, selected: f === current ? true : null, style: { fontFamily: `"${f}"` } }, f)));
  const preview = el('span', { class: 'muted', style: { marginLeft: '10px' } }, 'The quick brown fox — Ćevapi, šljiva, đak');
  const apply = () => { preview.style.fontFamily = `"${sel.value}"`; };
  sel.addEventListener('change', async () => {
    s.fontFamily = sel.value;
    apply(); applyTheme(); await persist();
  });
  apply();
  return el('div', { class: 'row' }, sel, preview);
}

// ---------- Automatic daily backup + cloud folders ----------
const CLOUD_SERVICES = [
  { id: 'onedrive', name: 'OneDrive' },
  { id: 'gdrive', name: 'Google Drive' },
  { id: 'dropbox', name: 'Dropbox' },
  { id: 'icloud', name: 'iCloud Drive' },
  { id: 'box', name: 'Box' },
  { id: 'mega', name: 'MEGA' },
  { id: 'pcloud', name: 'pCloud' }
];
const BACKUP_SUBFOLDER = 'Student Tracker Backup';
let openBackupBox = null; // re-checked when the window gets focus (after connecting an account)
const joinPath = (a, b) => a.replace(/[\\/]+$/, '') + '\\' + b;
const samePath = (a, b) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

async function renderBackupSection(box) {
  const s = data.settings;
  s.backupDestinations = s.backupDestinations || [];
  const [clouds, state] = await Promise.all([window.api.detectClouds(), window.api.backupState()]);
  const dests = s.backupDestinations;
  const save = async () => { await persist(); renderBackupSection(box); };

  // Enable switch
  const enabled = el('input', { type: 'checkbox', id: 'backupEnabled' });
  enabled.checked = !!s.backupEnabled;
  enabled.addEventListener('change', async () => {
    s.backupEnabled = enabled.checked;
    await save();
    if (s.backupEnabled && dests.length) { await window.api.runBackup(); renderBackupSection(box); }
  });

  // Destination list
  const destList = el('div', { class: 'dest-list' },
    dests.length
      ? dests.map((d, i) => el('div', { class: 'dest-row' },
          el('span', { class: 'dest-path', title: d }, d),
          el('button', { class: 'icon-btn', title: 'Open folder', onclick: () => window.api.openFile(d) }, '📁'),
          el('button', { class: 'icon-btn', title: 'Remove (existing backups are kept)', onclick: async () => { dests.splice(i, 1); await save(); } }, '✕')))
      : el('div', { class: 'muted' }, 'No backup folder yet. Add a cloud folder below or pick any folder.'),
    el('div', { class: 'row', style: { marginTop: '6px' } },
      el('button', {
        class: 'btn small', onclick: async () => {
          const f = await window.api.pickAnyFolder('Select a backup folder');
          if (!f || dests.some(d => samePath(d, f))) return;
          dests.push(f); await save();
        }
      }, '+ Add folder…'))
  );

  // Cloud services (via their desktop sync folders)
  const cloudRows = [];
  const shown = new Set();
  for (const svc of CLOUD_SERVICES) {
    const hits = clouds.filter(c => c.id === svc.id);
    if (!hits.length) {
      cloudRows.push(el('div', { class: 'cloud-row' },
        el('span', { class: 'cloud-name' }, svc.name),
        el('span', { class: 'muted cloud-path' }, 'Not connected'),
        el('button', {
          class: 'btn small', title: `Sign in to ${svc.name} on this computer`, onclick: async () => {
            const how = await window.api.connectCloud(svc.id);
            toast(how === 'app'
              ? `${svc.name} is opening — sign in, then come back here`
              : `Install ${svc.name} from the page that opened, sign in, then come back here`);
          }
        }, 'Connect account')));
    }
    hits.forEach(h => { shown.add(h.path); cloudRows.push(cloudRow(h)); });
  }
  clouds.filter(c => !shown.has(c.path)).forEach(h => cloudRows.push(cloudRow(h)));

  function cloudRow(h) {
    const target = joinPath(h.path, BACKUP_SUBFOLDER);
    const linked = dests.some(d => samePath(d, target));
    return el('div', { class: 'cloud-row' },
      el('span', { class: 'cloud-name' }, h.name),
      el('span', { class: 'muted cloud-path', title: h.path }, '✓ Connected · ' + h.path),
      linked
        ? el('span', { class: 'cloud-ok', title: target }, '✓ Backing up here')
        : el('button', {
            class: 'btn small primary', title: `Creates the folder “${BACKUP_SUBFOLDER}” in ${h.name}`,
            onclick: async () => {
              const r = await window.api.ensureFolder(target);
              if (r !== true) { toast('Could not create folder: ' + r); return; }
              dests.push(target); await save();
              toast(`Folder “${BACKUP_SUBFOLDER}” created in ${h.name}`);
            }
          }, 'Use for backup'));
  }

  // Status
  let statusText = 'No backup made yet.';
  if (state.lastRun) {
    const when = new Date(state.lastRun).toLocaleString();
    const failed = (state.lastResults || []).filter(r => !r.ok);
    statusText = failed.length
      ? `Last backup ${when} — failed for: ${failed.map(f => f.dest + ' (' + f.error + ')').join('; ')}`
      : `Last backup ${when} ✓`;
  }

  const keep = el('input', { type: 'number', min: 1, max: 365, value: s.backupKeep || 30, style: { width: '80px' } });
  keep.addEventListener('change', async () => {
    s.backupKeep = Math.min(365, Math.max(1, parseInt(keep.value, 10) || 30));
    await save();
  });

  openBackupBox = box;
  box.innerHTML = '';
  box.append(el('div', { class: 'form-grid' },
    el('label', { for: 'backupEnabled' }, 'Daily backup'),
    el('label', { class: 'check-row' }, enabled, el('span', {}, 'Back up automatically once a day')),
    el('label', {}, 'Backup folders'), destList,
    el('label', {}, 'Cloud storage'),
    el('div', { class: 'cloud-list' }, cloudRows,
      el('div', {}, el('button', { class: 'btn small', onclick: () => renderBackupSection(box) }, '⟳ Re-check accounts'))),
    el('div', { class: 'hint' },
      `“Connect account” opens the service’s app (or its download page) so you can sign in. Once connected, ` +
      `“Use for backup” creates a folder named “${BACKUP_SUBFOLDER}” in that cloud storage, and the daily backups are uploaded there automatically.`),
    el('label', {}, 'Keep'),
    el('div', { class: 'row' }, keep, el('span', { class: 'muted' }, 'latest daily backups per folder')),
    el('label', {}, 'Status'),
    el('div', {},
      el('div', { class: 'muted', style: { marginBottom: '6px' } }, statusText),
      el('button', {
        class: 'btn small', disabled: dests.length ? null : true, onclick: async e => {
          e.target.disabled = true; e.target.textContent = 'Backing up…';
          const r = await window.api.runBackup();
          toast(r.ok ? 'Backup saved' : 'Backup failed — see status');
          renderBackupSection(box);
        }
      }, 'Back up now'))
  ));
}

// ======================================================================
// Auto-update UI
// ======================================================================
let updateDismissed = false;
window.api.onUpdate(st => {
  const banner = $('#updateBanner'), text = $('#updateText'), action = $('#updateAction'), later = $('#updateLater');
  const settingsStatus = document.getElementById('settingsUpdateStatus');
  const setSettings = msg => { if (settingsStatus) settingsStatus.textContent = msg; };

  switch (st.status) {
    case 'checking': setSettings('Checking…'); break;
    case 'none': setSettings('You have the latest version.'); break;
    case 'dev': setSettings('Updates work only in the installed app.'); break;
    case 'error': setSettings('Update check failed: ' + st.message);
      if (!banner.classList.contains('hidden') && action.disabled) {
        text.textContent = 'Update failed: ' + st.message; action.disabled = false; action.textContent = 'Retry';
        action.onclick = () => window.api.downloadUpdate();
      }
      break;
    case 'available':
      setSettings(`Version ${st.version} is available.`);
      if (updateDismissed) break;
      text.textContent = `🎉 A new version (v${st.version}) is available.`;
      action.textContent = 'Update now'; action.disabled = false;
      action.onclick = () => {
        action.disabled = true; action.textContent = 'Downloading…'; later.classList.add('hidden');
        window.api.downloadUpdate();
      };
      later.classList.remove('hidden');
      banner.classList.remove('hidden');
      break;
    case 'progress':
      banner.classList.remove('hidden');
      text.textContent = `Downloading update… ${st.percent}%`;
      break;
    case 'downloaded':
      banner.classList.remove('hidden');
      text.textContent = `✅ Version ${st.version} is ready. The app will restart to finish the update.`;
      action.disabled = false; action.textContent = 'Restart & update';
      action.onclick = () => window.api.installUpdate();
      later.classList.remove('hidden');
      later.textContent = 'On next start';
      break;
  }
});
window.api.onBackup(r => {
  if (r.reason !== 'daily') return;
  toast(r.ok ? '✓ Daily backup saved' : '⚠ Daily backup failed — see Settings › Automatic backup');
});
$('#updateLater').addEventListener('click',() => { updateDismissed = true; $('#updateBanner').classList.add('hidden'); });

// ======================================================================
// Wire up & start
// ======================================================================
$('#search').addEventListener('input', e => { searchTerm = e.target.value.trim(); render(); });
$('#addStudentBtn').addEventListener('click', openAddStudent);
$('#settingsBtn').addEventListener('click', openSettings);
$('#editColumnsBtn').addEventListener('click', openColumnsEditor);

// Re-scan reports whenever the window gets focus (picks up newly saved report files)
let focusScan = 0;
window.addEventListener('focus', () => {
  // back from signing in to a cloud app: refresh the list if Settings is open
  if (openBackupBox && openBackupBox.isConnected && !$('#modalBackdrop').classList.contains('hidden')) renderBackupSection(openBackupBox);
});
window.addEventListener('focus', async () => {
  if (Date.now() - focusScan < 5000 || !data.settings.reportsFolder) return;
  focusScan = Date.now();
  await scanAllReports();
  if (!editingCount && $('#popover').classList.contains('hidden') && $('#modalBackdrop').classList.contains('hidden')) render();
});

(async function init() {
  data = await window.api.loadData();
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  if (ensureColumns(data.settings)) migrated = true;
  // (earlier test builds used the folder name "Student Tracker Backups")
  data.settings.backupDestinations = (data.settings.backupDestinations || [])
    .map(d => d.replace(/([\\/])Student Tracker Backups$/i, '$1' + BACKUP_SUBFOLDER));
  data.students.forEach(migrate);
  if (migrated) await persist();
  applyTheme();
  await scanAllReports();
  render();
})();
