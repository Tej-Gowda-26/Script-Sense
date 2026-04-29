import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Load VITE_* env vars from the single global .env at the project root
  envDir: '../../',
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
