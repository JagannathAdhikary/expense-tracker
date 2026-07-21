import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Hosted under a sub-path on the static host; must match manifest scope/start_url.
const BASE = '/expense-tracker/';

export default defineConfig({
  base: BASE,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Expense Tracker',
        short_name: 'Expenses',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#f5f6fa',
        theme_color: '#1E3A5F',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});
