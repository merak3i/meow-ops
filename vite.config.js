import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { spawn } from 'child_process';
import { statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Local-only dev plugin: exposes POST /api/sync to run the export script
// and GET /api/sync/status to read the timestamp of the generated JSON.
function meowSyncPlugin() {
  return {
    name: 'meow-sync',
    configureServer(server) {
      server.middlewares.use('/api/sync/status', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const filePath = join(server.config.root, 'public', 'data', 'sessions.json');
          const stat = statSync(filePath);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            ok: true,
            mtime: stat.mtimeMs,
            size: stat.size,
          }));
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'No data file yet' }));
        }
      });

      server.middlewares.use('/api/sync', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const scriptPath      = join(server.config.root, 'sync', 'export-local.mjs');
        const limitsScriptPath = join(server.config.root, 'sync', 'fetch-claude-limits.mjs');
        const child = spawn('node', [scriptPath], {
          cwd: server.config.root,
          env: process.env,
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        const timeout = setTimeout(() => {
          child.kill();
        }, 60000);

        child.on('close', (code) => {
          clearTimeout(timeout);
          let stats = null;
          try {
            const filePath = join(server.config.root, 'public', 'data', 'sessions.json');
            stats = statSync(filePath);
          } catch {}

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            ok: code === 0,
            code,
            stdout: stdout.slice(-2000),
            stderr: stderr.slice(-1000),
            mtime: stats?.mtimeMs || null,
            size: stats?.size || null,
          }));

          // After session sync completes, refresh rate limits in the background.
          // Reads Chrome cookie if possible; falls back to existing values.
          // Pass --push to also commit + push rate-limits.json to GitHub.
          spawn('node', [limitsScriptPath, '--push'], {
            cwd: server.config.root,
            env: process.env,
            stdio: 'ignore',
            detached: true,
          }).unref();
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      });
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
    // dedupe: force a single copy of three / react / react-dom across the
    // dep tree. Without this, @react-three/postprocessing transitively pulls
    // stats-gl which ships its own three, causing "Multiple instances of
    // THREE" + "Invalid hook call" runtime errors that black-screen the
    // canvas. With dedupe, all three.js + react references resolve to the
    // root install, fixing bloom + future R3F-postprocessing usage.
    dedupe: ['three', 'react', 'react-dom'],
  },
  plugins: [react(), tailwindcss(), meowSyncPlugin()],
});
