// After navBack() switches to a screen, that screen may need a re-render with the
// current state/month. This dispatcher calls the right render fn per screen id.
// Kept separate (with lazy imports) to avoid circular-import tangles between views.

import { state } from '../state.js';

export function renderForScreen(id) {
  switch (id) {
    case 'home':
      import('./home.js').then((m) => m.render());
      break;
    case 'catview':
      if (state.filterCat) import('./category.js').then((m) => m.renderCategoryView());
      break;
    case 'analytics':
      import('./analytics.js').then((m) => m.renderAnalytics());
      break;
    case 'groups':
      if (state.openGroupId) import('./groups.js').then((m) => m.refreshGroupsView());
      break;
    // 'add' needs no re-render on back-return (it's transient and rebuilt on open).
  }
}
