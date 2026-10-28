import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const hostPort = Number(process.env.OPTRACALL_HOST_PORT ?? 4175);
if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) throw new Error('Invalid OptraCall Host port.');
const proxy = { '/api': { target: `http://127.0.0.1:${hostPort}`, changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { proxy, watch: { ignored: ['**/.local/**', '**/tests/**', '**/docs/**', '**/openspec/**'] } },
  preview: { proxy },
});
