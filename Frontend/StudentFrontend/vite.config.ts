import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,   // fixed port — matches start_servers.bat expectation
    strictPort: true, // fail fast if 5174 is already occupied rather than silently using another port
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
