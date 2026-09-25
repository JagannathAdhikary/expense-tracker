// Export / import of personal expenses as CSV.
//
// One import path: importing a file adds its expense rows to state.recs. Rows carry an
// `id` in an app export, so re-importing an export is an idempotent RESTORE (existing ids
// are skipped); a hand-made/template CSV has no ids, so those rows always add. Export
// produces the same CSV shape the importer consumes (expenses only — categories/payments/
// prefs are not part of the file).
//
// Import runs in a modal (#importModal): pick a file, submit, then see a color-coded
// results table (green success / red failure) with the counts and a "Download report"
// button. Color lives in the modal because a plain .csv can't carry it; the downloaded
// report is a portable CSV with status/error columns.

import { state } from '../state.js';
import { isoDay, initialCat, initialPay } from '../format.js';
import { persist } from '../storage.js';
import { pushRecord } from './sync.js';
import { $ } from '../dom.js';
import { render } from '../views/home.js';
import { toastSuccess, toastError } from '../toast.js';
import { toCsv, templateCsv, parseCsv, headerMap, buildRecordFromRow, reportCsv } from '../csv.js';

// Trigger a client-side download of `text` as `filename` (text/csv).
function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Parse + validate the CSV text, commit successful rows to state, and return the
// per-row results (for the report + the modal table). Pure of DOM apart from state.
function runImport(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: 'CSV has no data rows.' };
  const hmap = headerMap(rows[0]);
  if (hmap.date == null || hmap.amount == null) {
    return { error: 'CSV must have "date" and "amount" columns.' };
  }

  const existingIds = new Set(state.recs.map((r) => r.id));
  const results = [];
  const toAdd = [];
  const idBase = Date.now();

  // App context so category/payment are matched against what the user already has (a
  // case-insensitive "food" maps to the existing "Food"); blanks fall back to the user's
  // defaults; unknown non-empty values fail the row (no silent auto-create).
  const opts = {
    cats: state.CATS.map((c) => c.n),
    pays: state.PAYS.map((p) => p.n),
    defaultCat: initialCat(),
    defaultPay: initialPay(),
  };

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const rowNum = i + 1; // 1-based, matching a spreadsheet (header is row 1)
    const res = buildRecordFromRow(cols, hmap, opts);
    if (!res.ok) {
      results.push({ row: rowNum, cols, hmap, status: 'FAILED', error: res.error });
      continue;
    }
    const rec = res.record;
    if (rec.id != null && existingIds.has(rec.id)) {
      results.push({ row: rowNum, cols, hmap, status: 'SKIPPED', error: 'Already exists (id)' });
      continue;
    }
    if (rec.id == null) rec.id = idBase + i;
    rec.updated = Date.now();
    existingIds.add(rec.id);
    toAdd.push(rec);
    results.push({ row: rowNum, cols, hmap, status: 'SUCCESS', error: '' });
  }

  if (toAdd.length) {
    toAdd.forEach((rec) => state.recs.push(rec));
    persist();
    toAdd.forEach((rec) => pushRecord(rec));
    render();
  }

  const added = toAdd.length;
  const failed = results.filter((r) => r.status === 'FAILED').length;
  const skipped = results.filter((r) => r.status === 'SKIPPED').length;
  return { results, added, failed, skipped, total: results.length };
}

// Render the import summary into the modal's step-2 view. Only the counts are shown here
// (imports can be thousands of rows — a per-row table would be unwieldy); the full row-by-
// row detail lives in the downloadable report CSV.
function showResults(outcome) {
  const { added, failed, skipped, total } = outcome;
  $('importPick').style.display = 'none';
  $('importResult').style.display = '';

  const parts = [`<span class="is-ok">✓ ${added} imported</span>`];
  if (skipped) parts.push(`<span class="is-skip">⤼ ${skipped} skipped</span>`);
  if (failed) parts.push(`<span class="is-fail">✕ ${failed} failed</span>`);
  $('importSummary').innerHTML = `<div class="is-counts">${parts.join('')}</div><div class="is-total">${total} row${total === 1 ? '' : 's'} processed${failed || skipped ? ' — download the report for details' : ''}</div>`;
}

// Reset the modal back to its file-picker step.
function resetImportModal() {
  $('importResult').style.display = 'none';
  $('importPick').style.display = '';
  $('importFile').value = '';
  $('importFileName').textContent = 'Choose a CSV file…';
  $('importSubmit').disabled = true;
}

// Show one tab panel of the data modal ('import' | 'export') and light its tab button.
function showTab(name) {
  document.querySelectorAll('#dataTabs .data-tab').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === name);
  });
  $('tabImport').style.display = name === 'import' ? '' : 'none';
  $('tabExport').style.display = name === 'export' ? '' : 'none';
}

// Compute [from, to] iso-day bounds (inclusive) for an export range key. Records store
// `date` as 'YYYY-MM-DD', so a lexicographic compare against these bounds is a date compare.
// 'custom' reads the two date inputs; returns null bounds for 'all' (no limit).
function rangeBounds(key) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === 'month') return { from: isoDay(new Date(y, m, 1)), to: isoDay(new Date(y, m + 1, 0)) };
  if (key === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (key === 'custom') return { from: $('exportFrom').value || '', to: $('exportTo').value || '' };
  return { from: '', to: '' }; // all time
}

// Records whose date falls within [from, to] (blank bound = open-ended), newest first.
function recordsInRange({ from, to }) {
  return state.recs
    .filter((r) => (!from || r.date >= from) && (!to || r.date <= to))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Reset the export tab to its default (This month, no custom dates).
function resetExportTab() {
  document.querySelectorAll('#exportRange .range-opt').forEach((c) => c.classList.toggle('on', c.dataset.range === 'month'));
  $('exportCustom').style.display = 'none';
  $('exportFrom').value = '';
  $('exportTo').value = '';
}

export function initBackup() {
  let exportRange = 'month';

  // One entry point: open the modal on the Import tab.
  $('dataBtn').onclick = () => {
    resetImportModal();
    exportRange = 'month';
    resetExportTab();
    showTab('import');
    updateExportCount();
    $('overlay').classList.remove('open');
    $('importModal').classList.add('open');
  };

  // Tab switching.
  document.querySelectorAll('#dataTabs .data-tab').forEach((b) => {
    b.onclick = () => showTab(b.dataset.tab);
  });

  // Template: the header (no id) + one example row, so users know the format to fill in.
  $('importTemplateLink').onclick = () => downloadCsv('expenses_template.csv', templateCsv());

  const closeModal = () => $('importModal').classList.remove('open');
  $('importCancel').onclick = closeModal;
  $('importDone').onclick = closeModal;
  $('exportCancel').onclick = closeModal;
  // Backdrop click closes.
  $('importModal').onclick = (e) => { if (e.target === $('importModal')) closeModal(); };

  // --- Import tab ---
  // File chosen -> show its name and enable Import.
  $('importFile').onchange = function () {
    const f = this.files[0];
    $('importFileName').textContent = f ? f.name : 'Choose a CSV file…';
    $('importSubmit').disabled = !f;
  };

  // Submit -> read, import, show results in the modal.
  let lastResults = null;
  $('importSubmit').onclick = function () {
    const file = $('importFile').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let outcome;
      try {
        outcome = runImport(e.target.result);
      } catch (err) {
        toastError('Could not read the CSV file.');
        return;
      }
      if (outcome.error) {
        toastError(outcome.error);
        return;
      }
      lastResults = outcome.results;
      showResults(outcome);
    };
    reader.readAsText(file);
  };

  // Download the portable CSV report of the last import.
  $('importReportBtn').onclick = () => {
    if (!lastResults) return;
    downloadCsv('import_report_' + isoDay(new Date()) + '.csv', reportCsv(lastResults));
    toastSuccess('Report downloaded.');
  };

  // --- Export tab ---
  document.querySelectorAll('#exportRange .range-opt').forEach((chip) => {
    chip.onclick = () => {
      exportRange = chip.dataset.range;
      document.querySelectorAll('#exportRange .range-opt').forEach((c) => c.classList.toggle('on', c === chip));
      $('exportCustom').style.display = exportRange === 'custom' ? '' : 'none';
      updateExportCount();
    };
  });
  $('exportFrom').onchange = updateExportCount;
  $('exportTo').onchange = updateExportCount;

  // Show how many records the current range covers (guides the user before download).
  function updateExportCount() {
    if (exportRange === 'custom' && (!$('exportFrom').value || !$('exportTo').value)) {
      $('exportCount').textContent = 'Pick a start and end date.';
      return;
    }
    const n = recordsInRange(rangeBounds(exportRange)).length;
    $('exportCount').textContent = `${n} expense${n === 1 ? '' : 's'} in this range.`;
  }

  $('exportSubmit').onclick = () => {
    const bounds = rangeBounds(exportRange);
    if (exportRange === 'custom') {
      if (!bounds.from || !bounds.to) { toastError('Pick a start and end date.'); return; }
      if (bounds.from > bounds.to) { toastError('Start date is after end date.'); return; }
    }
    const recs = recordsInRange(bounds);
    if (!recs.length) { toastError('No expenses in this range.'); return; }
    const suffix = exportRange === 'custom' ? `${bounds.from}_to_${bounds.to}` : exportRange === 'all' ? 'all' : `${exportRange}_${isoDay(new Date())}`;
    downloadCsv(`expenses_${suffix}.csv`, toCsv(recs));
    toastSuccess(`Exported ${recs.length} expense${recs.length === 1 ? '' : 's'}.`);
    closeModal();
  };
}
