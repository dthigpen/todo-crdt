import { defineConfig } from 'vite';

export default defineConfig({
    base: '/todo-crdt/',
    server: {
        host: '0.0.0.0',
        port: 8000,
        strictPort: true
    }
});
