// Export / import of personal expenses as CSV.
//
// One import path: importing a file adds its expense rows to state.recs. Rows carry an
// `id` in an app export, so re-importing an export is an idempotent RESTORE (existing ids
// are skipped); a hand-made/template CSV has no ids, so those rows always add. Export
// produces the same CSV shape the importer consumes (expenses only — categories/payments/
// prefs are not part of the file). After an import a CSV report is downloaded listing each
// row's SUCCESS / SKIPPED / FAILED status and the reason for any failure.

import { state } from '../state.js';
import { isoDay } from '../format.js';
import { persist, persistCats, persistPays } from '../storage.js';
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

// Auto-create a category by name if the user doesn't have one (case-insensitive).
// New categories get a neutral emoji/colour so the imported label stays usable + filterable.
function ensureCategory(name) {
  if (!name) return;
  const exists = state.CATS.some((c) => c.n.toLowerCase() === name.toLowerCase());
  if (!exists) state.CATS.push({ n: name, e: '📦', c: '#808B96' });
}

// Auto-create a payment method by name if missing (case-insensitive).
function ensurePayment(name) {
  if (!name) return;
  const exists = state.PAYS.some((p) => p.n.toLowerCase() === name.toLowerCase());
  if (!exists) state.PAYS.push({ n: name, e: '💰' });
}

export function initBackup() {
  // Export: every personal record as CSV (with id, so a re-import restores cleanly).
  $('exportBtn').onclick = function () {
    downloadCsv('expenses_export_' + isoDay(new Date()) + '.csv', toCsv(state.recs));
    $('overlay').classList.remove('open');
  };

  // Template: the header (no id) + one example row, so users know the format to fill in.
  $('templateBtn').onclick = function () {
    downloadCsv('expenses_template.csv', templateCsv());
    $('overlay').classList.remove('open');
  };

  $('importBtn').onclick = () => $('importFile').click();

  $('importFile').onchange = function () {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseCsv(e.target.result);
        if (rows.length < 2) {
          toastError('CSV has no data rows.');
          return;
        }
        const hmap = headerMap(rows[0]);
        // Required columns must be present in the header.
        if (hmap.date == null || hmap.amount == null) {
          toastError('CSV must have "date" and "amount" columns.');
          return;
        }

        const existingIds = new Set(state.recs.map((r) => r.id));
        const results = [];
        const toAdd = [];
        // Base for generated ids; row index keeps them unique within this import and
        // clear of the current second's other saves.
        const idBase = Date.now();

        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          const rowNum = i + 1; // 1-based, matching a spreadsheet (header is row 1)
          const res = buildRecordFromRow(cols, hmap);
          if (!res.ok) {
            results.push({ row: rowNum, cols, hmap, status: 'FAILED', error: res.error });
            continue;
          }
          const rec = res.record;
          // Idempotent restore: skip a row whose id we already have.
          if (rec.id != null && existingIds.has(rec.id)) {
            results.push({ row: rowNum, cols, hmap, status: 'SKIPPED', error: 'Already exists (id)' });
            continue;
          }
          // Assign an id when the row didn't supply one (hand-made CSV / template).
          if (rec.id == null) rec.id = idBase + i;
          rec.updated = Date.now();
          ensureCategory(rec.cat);
          ensurePayment(rec.pay);
          existingIds.add(rec.id);
          toAdd.push(rec);
          results.push({ row: rowNum, cols, hmap, status: 'SUCCESS', error: '' });
        }

        // Commit the successful rows: local state + persistence + cloud sync (if on).
        if (toAdd.length) {
          toAdd.forEach((rec) => state.recs.push(rec));
          persistCats();
          persistPays();
          persist();
          toAdd.forEach((rec) => pushRecord(rec));
          render();
        }

        // Always hand back a report of what happened.
        downloadCsv('import_report_' + isoDay(new Date()) + '.csv', reportCsv(results));

        const added = toAdd.length;
        const failed = results.filter((r) => r.status === 'FAILED').length;
        const total = results.length;
        $('overlay').classList.remove('open');
        if (failed) {
          toastError(`Imported ${added} of ${total} rows — ${failed} failed. See the report.`);
        } else {
          toastSuccess(`Imported ${added} of ${total} rows.`);
        }
      } catch (err) {
        toastError('Could not read the CSV file.');
      }
    };
    reader.readAsText(file);
    this.value = '';
  };
}
