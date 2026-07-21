// Export (backup) and import (restore) of records, categories, payments, and prefs.

import { state } from '../state.js';
import { isoDay } from '../format.js';
import { persist, persistCats, persistPays, persistPrefs } from '../storage.js';
import { $ } from '../dom.js';
import { render } from '../views/home.js';

export function initBackup() {
  $('exportBtn').onclick = function () {
    // Include categories/payments/prefs in backup so custom ones survive restore.
    const payload = { version: 3, exportedAt: new Date().toISOString(), cats: state.CATS, pays: state.PAYS, prefs: state.PREFS, records: state.recs };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'expenses_backup_' + isoDay(new Date()) + '.json';
    a.click();
    $('overlay').classList.remove('open');
  };

  $('importBtn').onclick = () => $('importFile').click();

  $('importFile').onchange = function () {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        // Support legacy array, v2 ({records, cats}), and v3 ({records, cats, pays, prefs}) formats.
        const importedRecs = Array.isArray(parsed) ? parsed : Array.isArray(parsed.records) ? parsed.records : null;
        if (!importedRecs) throw new Error();
        const importedCats = parsed && Array.isArray(parsed.cats) ? parsed.cats : null;
        const importedPays = parsed && Array.isArray(parsed.pays) ? parsed.pays : null;
        const importedPrefs = parsed && parsed.prefs && typeof parsed.prefs === 'object' ? parsed.prefs : null;
        const extras = [importedCats ? `${importedCats.length} categories` : null, importedPays ? `${importedPays.length} payment methods` : null].filter(Boolean).join(', ');
        if (confirm(`Import ${importedRecs.length} records${extras ? ` and ${extras}` : ''}? This will merge with existing data.`)) {
          const existingIds = new Set(state.recs.map((r) => r.id));
          importedRecs.forEach((r) => {
            if (!existingIds.has(r.id)) state.recs.push(r);
          });
          if (importedCats) {
            const existingNames = new Set(state.CATS.map((c) => c.n.toLowerCase()));
            importedCats.forEach((c) => {
              if (c && c.n && !existingNames.has(c.n.toLowerCase())) state.CATS.push(c);
            });
            persistCats();
          }
          if (importedPays) {
            const existingNames = new Set(state.PAYS.map((p) => p.n.toLowerCase()));
            importedPays.forEach((p) => {
              if (p && p.n && !existingNames.has(p.n.toLowerCase())) state.PAYS.push(p);
            });
            persistPays();
          }
          // Only adopt imported prefs if the current user hasn't set their own.
          if (importedPrefs) {
            if (!state.PREFS.defaultCat && importedPrefs.defaultCat) state.PREFS.defaultCat = importedPrefs.defaultCat;
            if (!state.PREFS.defaultPay && importedPrefs.defaultPay) state.PREFS.defaultPay = importedPrefs.defaultPay;
            persistPrefs();
          }
          persist();
          render();
          $('overlay').classList.remove('open');
          alert('Import successful!');
        }
      } catch (err) {
        alert('Invalid backup file.');
      }
    };
    reader.readAsText(file);
    this.value = '';
  };
}
