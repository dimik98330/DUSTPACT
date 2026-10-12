import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({command})=>({plugins:[react()],define:{'process.env':JSON.stringify({NODE_ENV:command==='build'?'production':'development'})},server:{strictPort:true},build:{chunkSizeWarningLimit:650}}));
