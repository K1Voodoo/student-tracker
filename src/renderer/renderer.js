'use strict';

// ======================================================================
// State
// ======================================================================
let data = { students: [], settings: {} };
let reportsCache = {};          // name -> [{path, mtime}]
let searchTerm = '';
let editingCount = null;        // student id whose lesson counter is open
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

// Text columns before the lesson counter
const TEXT_COLUMNS = [
  { key: 'level', label: 'Level', level: true },
  { key: 'needs', label: 'Needs' },
  { key: 'recurringMistakes', label: 'Recurring mistakes' },
  { key: 'vocabLearned', label: 'Vocabulary (learned)' },
  { key: 'vocabToLearn', label: 'Vocabulary (to be learned)' },
  { key: 'grammarCovered', label: 'Grammar covered' },
  { key: 'conversation', label: 'Conversation' }
];

// Fields that hold formatted text (HTML from the rich text editor)
const RICH_KEYS = ['needs', 'recurringMistakes', 'vocabLearned', 'vocabToLearn', 'grammarCovered',
  'conversation', 'todo', 'docsText', 'reportsText'];
const TODO_COLUMN = { key: 'todo', label: 'To do' };

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

function render() {
  closePopover(false);
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

function rerenderRow(s) {
  const tr = rowOf(s);
  const fresh = renderRow(s);
  if (tr) tr.replaceWith(fresh);
  return fresh;
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

  // Name
  const nameTd = el('td', { class: 'col-name' });
  nameTd.append(el('div', { class: 'name-cell', title: 'Show personal details' },
    el('span', { class: 'color-dot', style: { background: s.color || '#ccc' } }),
    el('span', {}, s.name)));
  nameTd.addEventListener('click', () => toggleDropdown(nameTd, () => openNameDropdown(s, nameTd)));
  tr.append(nameTd);

  // Level, Needs, Mistakes, Vocab, Vocab, Grammar
  for (const col of TEXT_COLUMNS) tr.append(renderTextCell(s, col));

  // Lesson count
  tr.append(renderCountCell(s));

  // Documents (completed) – files + text
  tr.append(renderFileCell(s, 'docs'));

  // Documents (to do) – text dropdown
  tr.append(renderTextCell(s, TODO_COLUMN));

  // Reports – files from the reports folder + text
  tr.append(renderFileCell(s, 'reports'));

  return tr;
}

function renderTextCell(s, col) {
  const val = s[col.key] || '';
  const td = el('td', { 'data-key': col.key });
  const content = !val
    ? el('div', { class: 'clamp' }, el('span', { class: 'muted' }, '—'))
    : col.level ? el('div', { class: 'clamp' }, val) : richNode(val, 'clamp');
  td.append(el('div', { class: 'text-cell', title: (col.level ? val : htmlToText(val)) || 'Click to edit' }, content));
  td.addEventListener('click', () => toggleDropdown(td, () =>
    col.level ? openLevelDropdown(s, col, td) : openTextDropdown(s, col, td)));
  return td;
}

function renderCountCell(s) {
  const td = el('td', { class: 'count-cell' });
  if (editingCount === s.id) {
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
            s.lessonCount = pendingCount;
            editingCount = null;
            await persist();
            td.replaceWith(renderCountCell(s));
            toast(`Lesson count saved for ${s.name}`);
          }
        }, 'Save'),
        el('button', {
          class: 'icon-btn', title: 'Cancel', onclick: () => {
            editingCount = null;
            td.replaceWith(renderCountCell(s));
          }
        }, '✕')
      )
    ));
  } else {
    td.append(el('span', {
      class: 'count-number', title: 'Click to change',
      onclick: () => {
        closePopover(true);
        if (editingCount && editingCount !== s.id) {
          const other = getStudent(editingCount);
          editingCount = null;
          if (other) rerenderRow(other);
        }
        editingCount = s.id;
        pendingCount = s.lessonCount || 0;
        td.replaceWith(renderCountCell(s));
      }
    }, s.lessonCount || 0));
  }
  return td;
}

// Cell for "Documents (completed)" and "Reports": a file-count chip and the
// first lines of the free text; click opens files + text editor below.
function renderFileCell(s, kind) {
  const isReports = kind === 'reports';
  const count = isReports ? (reportsCache[s.id] || []).length : (s.docsCompleted || []).length;
  const textKey = isReports ? 'reportsText' : 'docsText';
  const val = s[textKey] || '';
  const label = isReports ? (count === 1 ? 'report' : 'reports') : (count === 1 ? 'file' : 'files');
  const td = el('td', { class: 'file-cell', 'data-key': textKey });
  td.append(el('div', { class: 'text-cell', title: htmlToText(val) || 'Click to open' },
    el('div', { class: 'doc-chip' + (count ? ' has' : '') }, `${isReports ? '📊' : '📎'} ${count} ${label}`),
    richNode(val, 'clamp clamp-2')));
  td.addEventListener('click', () => toggleDropdown(td, () =>
    isReports ? openReportsDropdown(s, td) : openDocsDropdown(s, td)));
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
  const top = r.bottom - 1;
  p.style.top = top + 'px';
  p.style.maxHeight = Math.max(160, window.innerHeight - top - 10) + 'px';
  p.classList.remove('hidden');
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
    // first text node of the line the caret is on
    let first = c.block === ed ? c.range.startContainer : c.block;
    if (first.nodeType !== Node.TEXT_NODE) {
      const w = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
      first = w.nextNode();
    }
    if (!first || first.nodeType !== Node.TEXT_NODE) return;
    // the marker must be at the very start of the line
    if (c.block === ed && first.previousSibling && first.previousSibling.nodeName !== 'BR') return;
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
    if (num && num[1] !== '1') {
      const c2 = caretInfo();
      const ol = c2 && c2.li && c2.li.closest('ol');
      if (ol) ol.setAttribute('start', num[1]);
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
  const original = s[col.key] || '';
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
      s[col.key] = v;
      await persist();
      const cell = rowOf(s) && rowOf(s).querySelector(`td[data-key="${col.key}"]`);
      if (cell) cell.replaceWith(renderTextCell(s, col));
    }
  });
  rte.focus();
}

// ---------- Level menu ----------
function openLevelDropdown(s, col, td) {
  const setLevel = async v => {
    s.level = v;
    closePopover(false);
    await persist();
    const cell = rowOf(s) && rowOf(s).querySelector(`td[data-key="level"]`);
    if (cell) cell.replaceWith(renderTextCell(s, col));
  };
  const custom = el('input', { type: 'text', placeholder: 'Other (e.g. B1+)…', value: LEVELS.includes(s.level) ? '' : (s.level || ''), style: { width: '100%' } });
  custom.addEventListener('keydown', e => { if (e.key === 'Enter') setLevel(custom.value.trim()); });

  showDropdown(td, [
    el('div', { class: 'pop-body', style: { padding: '6px' } },
      LEVELS.map(l => el('button', { class: 'menu-item' + (s.level === l ? ' selected' : ''), onclick: () => setLevel(l) }, l)),
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
  grid.append(el('div', { class: 'label' }, 'Lessons'), el('div', { class: 'value' }, s.lessonCount || 0));
  grid.append(el('div', { class: 'label' }, 'Level'), el('div', { class: 'value' }, s.level || '—'));
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

const cellOf = (s, key) => rowOf(s) && rowOf(s).querySelector(`td[data-key="${key}"]`);

// ---------- Documents (completed): file list with Browse + text ----------
async function openDocsDropdown(s, td) {
  const list = s.docsCompleted || (s.docsCompleted = []);
  const exists = list.length ? await window.api.filesExist(list.map(d => d.path)) : [];
  const note = noteEditor(s, 'docsText');

  const ul = el('ul', { class: 'pop-list' });
  list.forEach((doc, i) => {
    ul.append(el('li', { class: exists[i] ? '' : 'missing', title: doc.path },
      el('span', { class: 'file-link', onclick: () => openFile(doc.path) }, baseName(doc.path)),
      el('span', { class: 'file-date' }, fmtDate(doc.added)),
      el('button', { class: 'icon-btn', title: 'Show in folder', onclick: () => window.api.revealFile(doc.path) }, '📁'),
      el('button', { class: 'icon-btn', title: 'Remove from list (file is not deleted)', onclick: () => { note.commit(); removeDoc(s, i); } }, '✕')
    ));
  });

  showDropdown(td, [
    popHead(`Done · ${s.name}`),
    list.length ? ul : el('div', { class: 'pop-empty' }, 'No documents yet.'),
    el('div', { class: 'pop-label' }, 'Notes'),
    note.ta,
    el('div', { class: 'pop-foot' },
      el('button', { class: 'btn small', style: { marginRight: 'auto' }, onclick: () => { note.commit(); browseDocs(s); } }, '📂 Browse…'),
      el('button', { class: 'btn small', onclick: () => closePopover(false) }, 'Cancel'),
      el('button', { class: 'btn primary small', onclick: () => closePopover(true) }, 'Save'))
  ], {
    width: 400,
    onClose: async save => {
      if (!save || !note.commit()) return;
      await persist();
      const c = cellOf(s, 'docsText');
      if (c) c.replaceWith(renderFileCell(s, 'docs'));
    }
  });
}

async function reopenDocs(s) {
  await persist();
  closePopover(false);
  rerenderRow(s);
  await openDocsDropdown(s, cellOf(s, 'docsText'));
}

async function browseDocs(s) {
  const paths = await window.api.pickFiles();
  let added = 0;
  for (const p of paths) {
    if (!s.docsCompleted.some(d => d.path.toLowerCase() === p.toLowerCase())) {
      s.docsCompleted.push({ path: p, added: Date.now() });
      added++;
    }
  }
  if (paths.length) toast(added ? `Added ${added} document${added > 1 ? 's' : ''}` : 'Already in the list');
  await reopenDocs(s);
}

async function removeDoc(s, i) {
  s.docsCompleted.splice(i, 1);
  await reopenDocs(s);
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

async function openReportsDropdown(s, td) {
  const src = reportsSource(s);
  const reportsFolder = src && src.folder;
  const reportsPattern = data.settings.reportsPattern;
  const note = noteEditor(s, 'reportsText');
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
    popHead(`Reports · ${s.name}`),
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
          rerenderRow(s);
          await openReportsDropdown(s, cellOf(s, 'reportsText'));
        }
      }, '⟳ Refresh') : null,
      el('button', { class: 'btn small', onclick: () => closePopover(false) }, 'Cancel'),
      el('button', { class: 'btn primary small', onclick: () => closePopover(true) }, 'Save'))
  ], {
    width: 400,
    onClose: async save => {
      const changed = save && note.commit();
      if (changed) await persist();
      const c = cellOf(s, 'reportsText');
      if (c) c.replaceWith(renderFileCell(s, 'reports')); // also refreshes the report count
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
  // (earlier test builds used the folder name "Student Tracker Backups")
  data.settings.backupDestinations = (data.settings.backupDestinations || [])
    .map(d => d.replace(/([\\/])Student Tracker Backups$/i, '$1' + BACKUP_SUBFOLDER));
  data.students.forEach(migrate);
  if (migrated) await persist();
  applyTheme();
  await scanAllReports();
  render();
})();
