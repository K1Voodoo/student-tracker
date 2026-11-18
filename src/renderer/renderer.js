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

const TEXT_COLUMNS = [
  { key: 'level', single: true },
  { key: 'needs' },
  { key: 'recurringMistakes' },
  { key: 'vocabLearned' },
  { key: 'vocabToLearn' },
  { key: 'grammarCovered' }
];

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
    lessonCount: 0, docsCompleted: [], docsTodo: [],
    createdAt: new Date().toISOString()
  };
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

function renderRow(s) {
  const tr = el('tr', { 'data-id': s.id });

  // Name
  tr.append(el('td', { class: 'col-name', style: { boxShadow: `inset 4px 0 0 ${s.color || 'transparent'}` } },
    el('div', { class: 'name-cell', title: 'Show personal details', onclick: () => openStudentModal(s.id) },
      el('span', { class: 'color-dot', style: { background: s.color || '#ccc' } }),
      el('span', {}, s.name)
    )
  ));

  // Text columns (Level, Needs, Mistakes, Vocab, Vocab, Grammar)
  for (const col of TEXT_COLUMNS) tr.append(renderTextCell(s, col));

  // Lesson count
  tr.append(renderCountCell(s));

  // Documents
  tr.append(renderListButtonCell(s, 'docsCompleted', 'Completed', (s.docsCompleted || []).length));
  tr.append(renderListButtonCell(s, 'docsTodo', 'To do', (s.docsTodo || []).length));

  // Reports
  const reps = reportsCache[s.name] || [];
  tr.append(renderListButtonCell(s, 'reports', 'Reports', reps.length));

  return tr;
}

function renderTextCell(s, col) {
  const val = s[col.key] || '';
  const td = el('td');
  const div = el('div', { class: 'text-cell', title: 'Click to edit' }, val || el('span', { class: 'muted' }, '—'));
  div.addEventListener('click', () => startTextEdit(td, s, col));
  td.append(div);
  return td;
}

function startTextEdit(td, s, col) {
  const original = s[col.key] || '';
  const editor = col.single
    ? el('input', { class: 'cell-editor', type: 'text', list: 'levelList', value: original })
    : el('textarea', { class: 'cell-editor' });
  if (!col.single) editor.value = original;

  if (col.single && !$('#levelList')) {
    const dl = el('datalist', { id: 'levelList' },
      ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(l => el('option', { value: l })));
    document.body.append(dl);
  }

  let done = false;
  const finish = async save => {
    if (done) return;
    done = true;
    if (save && editor.value !== original) {
      s[col.key] = editor.value.trim() ? editor.value : '';
      await persist();
    }
    td.replaceWith(renderTextCell(s, col));
  };
  editor.addEventListener('blur', () => finish(true));
  editor.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    if (e.key === 'Enter' && (col.single || e.ctrlKey)) { e.preventDefault(); finish(true); }
  });
  td.innerHTML = '';
  td.append(editor);
  editor.focus();
  if (!col.single) editor.setSelectionRange(editor.value.length, editor.value.length);
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
        // close any other open counter
        if (editingCount && editingCount !== s.id) {
          const other = document.querySelector(`tr[data-id="${editingCount}"]`);
          editingCount = null;
          if (other) { const os = getStudent(other.dataset.id); other.replaceWith(renderRow(os)); }
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
  const icon = kind === 'reports' ? '📊' : kind === 'docsCompleted' ? '✅' : '📝';
  const btn = el('button', { class: 'btn list-btn' },
    el('span', {}, `${icon} ${label}`),
    el('span', { class: 'badge' + (count ? ' has' : '') }, count)
  );
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (kind === 'reports') openReportsPopover(s, btn);
    else openDocsPopover(s, kind, btn);
  });
  return el('td', { class: 'btn-cell' }, btn);
}

// ======================================================================
// Popovers (document lists & reports)
// ======================================================================
let popoverAnchor = null;

function closePopover() {
  $('#popover').classList.add('hidden');
  popoverAnchor = null;
}

function positionPopover(anchor) {
  const pop = $('#popover');
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - pw - 10);
  left = Math.max(10, left);
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 10) top = Math.max(10, r.top - ph - 6);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

async function openDocsPopover(s, kind, anchor) {
  if (popoverAnchor === anchor) { closePopover(); return; }
  popoverAnchor = anchor;
  const pop = $('#popover');
  const list = s[kind] || (s[kind] = []);
  const title = kind === 'docsCompleted' ? 'Documents — completed' : 'Documents — to do';
  const exists = list.length ? await window.api.filesExist(list.map(d => d.path)) : [];

  const ul = el('ul', { class: 'pop-list' });
  list.forEach((doc, i) => {
    const li = el('li', { class: exists[i] ? '' : 'missing', title: doc.path },
      el('span', { class: 'file-link', onclick: () => openFile(doc.path) }, baseName(doc.path)),
      el('span', { class: 'file-date' }, fmtDate(doc.added)),
      el('button', { class: 'icon-btn', title: 'Show in folder', onclick: () => window.api.revealFile(doc.path) }, '📁'),
      kind === 'docsTodo'
        ? el('button', { class: 'icon-btn', title: 'Mark as completed', onclick: () => moveDoc(s, kind, 'docsCompleted', i, anchor) }, '✔')
        : el('button', { class: 'icon-btn', title: 'Move back to “to do”', onclick: () => moveDoc(s, kind, 'docsTodo', i, anchor) }, '↩'),
      el('button', { class: 'icon-btn', title: 'Remove from list (file is not deleted)', onclick: () => removeDoc(s, kind, i, anchor) }, '✕')
    );
    ul.append(li);
  });

  pop.innerHTML = '';
  pop.append(
    el('div', { class: 'pop-head' }, el('strong', {}, `${title} · ${s.name}`),
      el('button', { class: 'icon-btn', onclick: closePopover }, '✕')),
    list.length ? ul : el('div', { class: 'pop-empty' }, 'No documents yet.'),
    el('div', { class: 'pop-foot' },
      el('button', { class: 'btn primary small', onclick: () => browseDocs(s, kind, anchor) }, '📂 Browse…'))
  );
  positionPopover(anchor);
}

async function refreshDocsPopover(s, kind, anchor) {
  await persist();
  // re-render row (updates badge), then reopen popover on the new button
  const tr = document.querySelector(`tr[data-id="${s.id}"]`);
  const idx = kind === 'docsCompleted' ? 0 : 1;
  if (tr) {
    const newRow = renderRow(s);
    tr.replaceWith(newRow);
    const btns = newRow.querySelectorAll('.list-btn');
    popoverAnchor = null;
    await openDocsPopover(s, kind, btns[idx]);
  } else {
    popoverAnchor = null;
    await openDocsPopover(s, kind, anchor);
  }
}

async function browseDocs(s, kind, anchor) {
  const paths = await window.api.pickFiles();
  if (!paths.length) return;
  const list = s[kind] || (s[kind] = []);
  let added = 0;
  for (const p of paths) {
    if (!list.some(d => d.path.toLowerCase() === p.toLowerCase())) {
      list.push({ path: p, added: Date.now() });
      added++;
    }
  }
  toast(added ? `Added ${added} document${added > 1 ? 's' : ''}` : 'Already in the list');
  await refreshDocsPopover(s, kind, anchor);
}

async function moveDoc(s, from, to, i, anchor) {
  const [doc] = s[from].splice(i, 1);
  (s[to] || (s[to] = [])).push({ ...doc, added: Date.now() });
  toast(to === 'docsCompleted' ? 'Moved to completed' : 'Moved back to “to do”');
  await refreshDocsPopover(s, from, anchor);
}

async function removeDoc(s, kind, i, anchor) {
  s[kind].splice(i, 1);
  await refreshDocsPopover(s, kind, anchor);
}

async function openFile(p) {
  const err = await window.api.openFile(p);
  if (err) toast(err);
}

async function scanAllReports() {
  const { reportsFolder, reportsPattern } = data.settings;
  if (!reportsFolder) { reportsCache = {}; return; }
  reportsCache = await window.api.scanReports({
    folder: reportsFolder, pattern: reportsPattern, names: data.students.map(s => s.name)
  });
}

async function openReportsPopover(s, anchor) {
  if (popoverAnchor === anchor) { closePopover(); return; }
  popoverAnchor = anchor;
  const pop = $('#popover');
  const { reportsFolder, reportsPattern } = data.settings;

  pop.innerHTML = '';
  pop.append(el('div', { class: 'pop-head' }, el('strong', {}, `Reports · ${s.name}`),
    el('button', { class: 'icon-btn', onclick: closePopover }, '✕')));

  if (!reportsFolder) {
    pop.append(
      el('div', { class: 'pop-empty' }, 'No reports folder selected yet.'),
      el('div', { class: 'pop-foot' }, el('button', { class: 'btn primary small', onclick: () => { closePopover(); openSettings(); } }, '⚙ Open settings'))
    );
    positionPopover(anchor);
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

  pop.append(
    el('div', { class: 'pop-sub' }, `Folder: ${reportsFolder} · Pattern: ${reportsPattern || '*{name}*'}`),
    reps.length ? ul : el('div', { class: 'pop-empty' }, 'No reports found for this student.'),
    el('div', { class: 'pop-foot' },
      el('button', {
        class: 'btn small', onclick: async () => {
          popoverAnchor = null;
          const tr = document.querySelector(`tr[data-id="${s.id}"]`);
          const newRow = renderRow(s);
          if (tr) tr.replaceWith(newRow);
          await openReportsPopover(s, newRow.querySelectorAll('.list-btn')[2]);
        }
      }, '⟳ Refresh'))
  );
  positionPopover(anchor);

  // keep the badge in sync
  const badge = anchor.querySelector('.badge');
  if (badge) { badge.textContent = reps.length; badge.classList.toggle('has', reps.length > 0); }
}

document.addEventListener('mousedown', e => {
  const pop = $('#popover');
  if (pop.classList.contains('hidden')) return;
  if (pop.contains(e.target) || (popoverAnchor && popoverAnchor.contains(e.target))) return;
  closePopover();
});
window.addEventListener('resize', closePopover);
$('.table-wrap') && $('.table-wrap').addEventListener('scroll', closePopover);

// ======================================================================
// Modal helpers
// ======================================================================
function openModal(...content) {
  closePopover();
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
    else closePopover();
  }
});

// ======================================================================
// Student details (view / edit / add)
// ======================================================================
function openStudentModal(id) {
  const s = getStudent(id);
  if (!s) return;
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

  openModal(
    el('div', { class: 'modal-head' },
      el('h2', {}, el('span', { class: 'color-dot', style: { background: s.color, width: '16px', height: '16px' } }), s.name),
      el('button', { class: 'icon-btn', onclick: closeModal }, '✕')),
    el('div', { class: 'modal-body' }, grid),
    el('div', { class: 'modal-foot' },
      el('div', { class: 'right' },
        el('button', { class: 'btn', onclick: closeModal }, 'Close'),
        el('button', { class: 'btn primary', onclick: () => openStudentForm(s) }, '✎ Edit')))
  );
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

function openStudentForm(existing) {
  const isNew = !existing;
  const s = existing || newStudent('');
  const p = s.personal || {};
  const inputs = {};

  const nameInput = el('input', { type: 'text', value: s.name, placeholder: 'Full name' });
  const picker = colorPicker(s.color);

  const form = el('div', { class: 'form-grid' },
    el('label', {}, 'Name *'), nameInput,
    el('label', {}, 'Color'), picker.node
  );
  for (const f of PERSONAL_FIELDS) {
    let input;
    if (f.type === 'textarea') { input = el('textarea'); input.value = p[f.key] || ''; }
    else input = el('input', { type: f.type, value: p[f.key] || '' });
    inputs[f.key] = input;
    form.append(el('label', {}, f.label), input);
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
    if (isNew) data.students.push(s);
    await persist();
    await scanAllReports();
    render();
    if (isNew) { closeModal(); toast(`${name} added`); }
    else openStudentModal(s.id);
  };

  const foot = el('div', { class: 'modal-foot' });
  if (!isNew) {
    foot.append(el('button', {
      class: 'btn danger', onclick: async () => {
        if (!confirm(`Delete ${s.name} and all of their data from the tracker?\n(Your document files on disk are NOT deleted.)`)) return;
        data.students = data.students.filter(o => o.id !== s.id);
        await persist();
        closeModal();
        render();
        toast(`${s.name} deleted`);
      }
    }, '🗑 Delete student'));
  }
  foot.append(el('div', { class: 'right' },
    el('button', { class: 'btn', onclick: () => isNew ? closeModal() : openStudentModal(s.id) }, 'Cancel'),
    el('button', { class: 'btn primary', onclick: save }, isNew ? 'Add student' : 'Save')));

  openModal(
    el('div', { class: 'modal-head' }, el('h2', {}, isNew ? 'Add student' : `Edit · ${s.name}`),
      el('button', { class: 'icon-btn', onclick: closeModal }, '✕')),
    el('div', { class: 'modal-body' }, form),
    foot
  );
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  nameInput.focus();
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

  const folderInput = el('input', { type: 'text', value: s.reportsFolder || '', placeholder: 'No folder selected' , readonly: true });
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
$('#addStudentBtn').addEventListener('click', () => openStudentForm(null));
$('#settingsBtn').addEventListener('click', openSettings);

// Re-scan reports whenever the window gets focus (picks up newly saved report files)
let focusScan = 0;
window.addEventListener('focus', async () => {
  if (Date.now() - focusScan < 5000 || !data.settings.reportsFolder) return;
  focusScan = Date.now();
  await scanAllReports();
  if (!editingCount && !document.querySelector('.cell-editor') && $('#popover').classList.contains('hidden')) render();
});

(async function init() {
  data = await window.api.loadData();
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  applyTheme();
  await scanAllReports();
  render();
})();
