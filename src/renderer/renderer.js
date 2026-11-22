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
  { key: 'grammarCovered', label: 'Grammar covered' }
];
const TODO_COLUMN = { key: 'todo', label: 'Documents (to do)' };

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const COLOR_SWATCHES = [
  '#3b6ef5', '#2e9d5b', '#d64545', '#e8912d', '#9b51e0',
  '#14a3b8', '#e04f9b', '#7a8394', '#c9a227', '#5c3d2e'
];

const DEFAULT_SETTINGS = {
  bgColor: '#f6f7fb', lineColor: '#d5d9e2', textColor: '#1f2430',
  reportsFolder: '', reportsPattern: '*{name}*'
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
}

// ======================================================================
// Table rendering
// ======================================================================
function matchesSearch(s) {
  if (!searchTerm) return true;
  const hay = [s.name, ...Object.values(s.personal || {})].join(' \u0001 ').toLowerCase();
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
  if (s.color) tr.style.setProperty('--row', s.color);

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

  // Documents (completed) – file list
  tr.append(renderListButtonCell(s, 'docsCompleted', 'Completed', (s.docsCompleted || []).length));

  // Documents (to do) – text dropdown
  tr.append(renderTextCell(s, TODO_COLUMN));

  // Reports
  const reps = reportsCache[s.name] || [];
  tr.append(renderListButtonCell(s, 'reports', 'Reports', reps.length));

  return tr;
}

function renderTextCell(s, col) {
  const val = s[col.key] || '';
  const td = el('td', { 'data-key': col.key });
  td.append(el('div', { class: 'text-cell', title: val || 'Click to edit' },
    el('div', { class: 'clamp' }, val || el('span', { class: 'muted' }, '—'))));
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

function renderListButtonCell(s, kind, label, count) {
  const icon = kind === 'reports' ? '📊' : '✅';
  const btn = el('button', { class: 'btn list-btn' },
    el('span', {}, `${icon} ${label}`),
    el('span', { class: 'badge' + (count ? ' has' : '') }, count)
  );
  const td = el('td', { class: 'btn-cell' }, btn);
  btn.addEventListener('click', () => toggleDropdown(td, () =>
    kind === 'reports' ? openReportsDropdown(s, td) : openDocsDropdown(s, td)));
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

// ---------- Text field editor with bullet points ----------
function bulletize(textarea) {
  // "- " at the start of a line becomes "• " (same length, so the cursor stays put)
  textarea.addEventListener('input', () => {
    const v = textarea.value;
    const nv = v.replace(/(^|\n)- /g, '$1• ');
    if (nv !== v) {
      const a = textarea.selectionStart, b = textarea.selectionEnd;
      textarea.value = nv;
      textarea.setSelectionRange(a, b);
    }
  });
  // Lists: a line starting with "• " (bullet) or "1. " (number) is a list item.
  //  Enter      -> new item ("• " or the next number)
  //  Backspace  -> right after the marker, removes the whole marker and ends the list
  const MARKER = /^(• |(\d+)\. )/;
  textarea.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const pos = textarea.selectionStart;
    if (pos !== textarea.selectionEnd) return;
    const v = textarea.value;
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    const lineEndIdx = v.indexOf('\n', pos);
    const lineEnd = lineEndIdx === -1 ? v.length : lineEndIdx;
    const line = v.slice(lineStart, lineEnd);
    const m = line.match(MARKER);
    if (!m) return;

    if (e.key === 'Backspace' && pos === lineStart + m[0].length) {
      e.preventDefault();
      textarea.setRangeText('', lineStart, pos, 'end');
      if (m[2]) renumberFrom(textarea, lineStart);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (pos < lineStart + m[0].length) return; // cursor inside the marker: plain Enter
      e.preventDefault();
      const next = m[2] ? `${parseInt(m[2], 10) + 1}. ` : '• ';
      textarea.setRangeText('\n' + next, pos, pos, 'end');
      if (m[2]) renumberFrom(textarea, textarea.selectionStart);
    }
  });
}

// After inserting/removing a numbered item, renumber the numbered lines that
// directly follow the line at `index`, so the list stays 1, 2, 3, …
function renumberFrom(textarea, index) {
  const v = textarea.value;
  const lineStart = v.lastIndexOf('\n', index - 1) + 1;
  const lines = v.slice(lineStart).split('\n');
  const first = lines[0].match(/^(\d+)\. /);
  let n = 0;
  if (first) n = parseInt(first[1], 10);
  else if (lineStart > 0) {
    // the line is no longer numbered: continue from the numbered line above it
    const prevStart = v.lastIndexOf('\n', lineStart - 2) + 1;
    const prev = v.slice(prevStart, lineStart - 1).match(/^(\d+)\. /);
    if (prev) n = parseInt(prev[1], 10);
  }
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+)\. /);
    if (!m) break;
    n++;
    lines[i] = `${n}. ` + lines[i].slice(m[0].length);
  }
  const nv = v.slice(0, lineStart) + lines.join('\n');
  if (nv !== v) {
    const a = textarea.selectionStart;
    textarea.value = nv;
    textarea.setSelectionRange(a, a);
  }
}

function openTextDropdown(s, col, td) {
  const original = s[col.key] || '';
  const ta = el('textarea', { class: 'dd-editor', placeholder: 'Type here…  Start a line with "- " for a bullet point.' });
  ta.value = original;
  bulletize(ta);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); closePopover(true); }
  });

  showDropdown(td, [
    popHead(`${col.label} · ${s.name}`),
    ta,
    el('div', { class: 'pop-foot' },
      el('span', { class: 'dd-hint' }, '"- " bullets · "1. " numbers · Backspace ends list · Ctrl+Enter save · Esc cancel'),
      el('button', { class: 'btn small', onclick: () => closePopover(false) }, 'Cancel'),
      el('button', { class: 'btn primary small', onclick: () => closePopover(true) }, 'Save'))
  ], {
    width: 380,
    onClose: async save => {
      const v = ta.value.replace(/\s+$/, '');
      if (!save || v === original) return;
      s[col.key] = v;
      await persist();
      const cell = rowOf(s) && rowOf(s).querySelector(`td[data-key="${col.key}"]`);
      if (cell) cell.replaceWith(renderTextCell(s, col));
    }
  });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
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
  for (const f of PERSONAL_FIELDS) {
    const v = p[f.key];
    let valueNode;
    if (!v) valueNode = el('span', { class: 'muted' }, '—');
    else if (f.key === 'preplyLink' && /^https?:\/\//i.test(v)) valueNode = el('a', { onclick: () => window.open(v) }, v);
    else if (f.key === 'email') valueNode = el('a', { onclick: () => window.open('mailto:' + v) }, v);
    else if (f.type === 'date') valueNode = new Date(v).toLocaleDateString();
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

  const body = el('div', { class: 'form-grid' },
    el('label', {}, 'Name *'), nameInput,
    el('label', {}, 'Row color'), picker.node
  );
  for (const f of PERSONAL_FIELDS) {
    let input;
    if (f.type === 'textarea') { input = el('textarea'); input.value = p[f.key] || ''; }
    else input = el('input', { type: f.type, value: p[f.key] || '' });
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

// ---------- Documents (completed): file list with Browse ----------
async function openDocsDropdown(s, td) {
  const list = s.docsCompleted || (s.docsCompleted = []);
  const exists = list.length ? await window.api.filesExist(list.map(d => d.path)) : [];

  const ul = el('ul', { class: 'pop-list' });
  list.forEach((doc, i) => {
    ul.append(el('li', { class: exists[i] ? '' : 'missing', title: doc.path },
      el('span', { class: 'file-link', onclick: () => openFile(doc.path) }, baseName(doc.path)),
      el('span', { class: 'file-date' }, fmtDate(doc.added)),
      el('button', { class: 'icon-btn', title: 'Show in folder', onclick: () => window.api.revealFile(doc.path) }, '📁'),
      el('button', { class: 'icon-btn', title: 'Remove from list (file is not deleted)', onclick: () => removeDoc(s, i) }, '✕')
    ));
  });

  showDropdown(td, [
    popHead(`Documents — completed · ${s.name}`),
    list.length ? ul : el('div', { class: 'pop-empty' }, 'No documents yet.'),
    el('div', { class: 'pop-foot' },
      el('button', { class: 'btn primary small', onclick: () => browseDocs(s) }, '📂 Browse…'))
  ], { width: 380 });
}

async function reopenDocs(s) {
  await persist();
  closePopover(false);
  const fresh = rerenderRow(s);
  await openDocsDropdown(s, fresh.querySelectorAll('.btn-cell')[0]);
}

async function browseDocs(s) {
  const paths = await window.api.pickFiles();
  if (!paths.length) return;
  let added = 0;
  for (const p of paths) {
    if (!s.docsCompleted.some(d => d.path.toLowerCase() === p.toLowerCase())) {
      s.docsCompleted.push({ path: p, added: Date.now() });
      added++;
    }
  }
  toast(added ? `Added ${added} document${added > 1 ? 's' : ''}` : 'Already in the list');
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

// ---------- Reports ----------
async function scanAllReports() {
  const { reportsFolder, reportsPattern } = data.settings;
  if (!reportsFolder) { reportsCache = {}; return; }
  reportsCache = await window.api.scanReports({
    folder: reportsFolder, pattern: reportsPattern, names: data.students.map(s => s.name)
  });
}

async function openReportsDropdown(s, td) {
  const { reportsFolder, reportsPattern } = data.settings;

  if (!reportsFolder) {
    showDropdown(td, [
      popHead(`Reports · ${s.name}`),
      el('div', { class: 'pop-empty' }, 'No reports folder selected yet.'),
      el('div', { class: 'pop-foot' }, el('button', { class: 'btn primary small', onclick: () => { closePopover(false); openSettings(); } }, '⚙ Open settings'))
    ]);
    return;
  }

  const res = await window.api.scanReports({ folder: reportsFolder, pattern: reportsPattern, names: [s.name] });
  const reps = res[s.name] || [];
  reportsCache[s.name] = reps;

  const ul = el('ul', { class: 'pop-list' },
    reps.map(r => el('li', { title: r.path },
      el('span', { class: 'file-link', onclick: () => openFile(r.path) }, baseName(r.path)),
      el('span', { class: 'file-date' }, fmtDate(r.mtime)),
      el('button', { class: 'icon-btn', title: 'Show in folder', onclick: () => window.api.revealFile(r.path) }, '📁')
    )));

  showDropdown(td, [
    popHead(`Reports · ${s.name}`),
    el('div', { class: 'pop-sub' }, `Folder: ${reportsFolder} · Pattern: ${reportsPattern || '*{name}*'}`),
    reps.length ? ul : el('div', { class: 'pop-empty' }, 'No reports found for this student.'),
    el('div', { class: 'pop-foot' },
      el('button', {
        class: 'btn small', onclick: async () => {
          closePopover(false);
          const fresh = rerenderRow(s);
          await openReportsDropdown(s, fresh.querySelectorAll('.btn-cell')[1]);
        }
      }, '⟳ Refresh'))
  ]);

  const badge = td.querySelector('.badge');
  if (badge) { badge.textContent = reps.length; badge.classList.toggle('has', reps.length > 0); }
}

// ======================================================================
// Modal helpers
// ======================================================================
function openModal(...content) {
  closePopover(true);
  const m = $('#modal');
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

  openModal(
    el('div', { class: 'modal-head' }, el('h2', {}, '⚙ Settings'), el('button', { class: 'icon-btn', onclick: closeModal }, '✕')),
    el('div', { class: 'modal-body' },
      el('div', { class: 'section-title' }, 'Appearance'),
      el('div', { class: 'form-grid' },
        ...colorInput('bgColor', 'Background color'),
        ...colorInput('lineColor', 'Line color'),
        ...colorInput('textColor', 'Text color'),
        el('span'),
        el('div', {}, el('button', {
          class: 'btn small', onclick: async () => {
            Object.assign(s, { bgColor: DEFAULT_SETTINGS.bgColor, lineColor: DEFAULT_SETTINGS.lineColor, textColor: DEFAULT_SETTINGS.textColor });
            applyTheme(); await persist(); openSettings();
          }
        }, 'Reset colors'))
      ),

      el('div', { class: 'section-title' }, 'Reports'),
      el('div', { class: 'form-grid' },
        el('label', {}, 'Reports folder'),
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
        el('label', {}, 'Backup'),
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
      )
    ),
    el('div', { class: 'modal-foot' }, el('div', { class: 'right' }, el('button', { class: 'btn primary', onclick: closeModal }, 'Done')))
  );
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
$('#updateLater').addEventListener('click', () => { updateDismissed = true; $('#updateBanner').classList.add('hidden'); });

// ======================================================================
// Wire up & start
// ======================================================================
$('#search').addEventListener('input', e => { searchTerm = e.target.value.trim(); render(); });
$('#addStudentBtn').addEventListener('click', openAddStudent);
$('#settingsBtn').addEventListener('click', openSettings);

// Re-scan reports whenever the window gets focus (picks up newly saved report files)
let focusScan = 0;
window.addEventListener('focus', async () => {
  if (Date.now() - focusScan < 5000 || !data.settings.reportsFolder) return;
  focusScan = Date.now();
  await scanAllReports();
  if (!editingCount && $('#popover').classList.contains('hidden') && $('#modalBackdrop').classList.contains('hidden')) render();
});

(async function init() {
  data = await window.api.loadData();
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  data.students.forEach(migrate);
  applyTheme();
  await scanAllReports();
  render();
})();
