import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { spawn } from 'child_process';
import { statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getSyncRun, getSyncStatus, startSyncRun } from './sync/sync-runner.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Local-only dev plugin: exposes the same observable background sync contract
// as the localhost helper.
function meowSyncPlugin() {
  return {
    name: 'meow-sync',
    configureServer(server) {
      // Local-only guard. These endpoints spawn local processes, so they must
      // never be reachable from another site. Reject non-localhost Host headers
      // (DNS-rebinding) and any cross-origin request. Without this, a page the
      // developer visits during `npm run dev` could POST /api/sync.
      function blockNonLocal(req, res) {
        const host = String(req.headers.host || '').split(':')[0].replace(/[[\]]/g, '');
        const okHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
        let okOrigin = true;
        if (req.headers.origin) {
          try {
            const h = new URL(req.headers.origin).hostname;
            okOrigin = h === 'localhost' || h === '127.0.0.1' || h === '::1';
          } catch { okOrigin = false; }
        }
        if (!okHost || !okOrigin) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'forbidden (local-only endpoint)' }));
          return true;
        }
        return false;
      }

      server.middlewares.use('/api/sync/status', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(getSyncStatus({ repoRoot: server.config.root })));
      });

      server.middlewares.use('/api/sync/runs', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        const runId = new URL(req.url || '/', 'http://localhost').pathname.split('/').filter(Boolean)[0];
        const run = getSyncRun(runId);
        res.statusCode = run ? 200 : 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(run || { ok: false, error: 'Sync run not found' }));
      });

      // Dev-mode mirror of the local API's Loop-Ops endpoints (sync/local-api.mjs).
      // GETs for spec/runs aren't needed here — Vite serves public/data/ directly.
      server.middlewares.use('/api/loop-ops/status', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        const dir = join(server.config.root, 'public', 'data', 'loop-ops');
        const files = {};
        for (const name of ['spec.json', 'gates.json', 'runs.json']) {
          try {
            const st = statSync(join(dir, name));
            files[name] = { mtime: st.mtimeMs, size: st.size };
          } catch { files[name] = null; }
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: files['spec.json'] !== null, files, productionWritesEnabled: false }));
      });

      server.middlewares.use('/api/loop-ops/sync', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        if (blockNonLocal(req, res)) return;
        // No env option — the child inherits the dev server's environment.
        const child = spawn('node', [join(server.config.root, 'sync', 'loop-ops-import.mjs')], {
          cwd: server.config.root,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => { stdout += c.toString(); });
        child.stderr.on('data', (c) => { stderr += c.toString(); });
        const timeout = setTimeout(() => child.kill(), 90_000);
        child.on('close', (code) => {
          clearTimeout(timeout);
          let mtime = null;
          try { mtime = statSync(join(server.config.root, 'public', 'data', 'loop-ops', 'spec.json')).mtimeMs; } catch { /* not written yet */ }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: code === 0, code, stdout: stdout.slice(-2000), stderr: stderr.slice(-500), mtime }));
        });
        child.on('error', (err) => {
          clearTimeout(timeout);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      });

      // Dev-mode mirror of sync/local-api.mjs for the Capacity & Usage page.
      server.middlewares.use('/api/superadmin-usage/status', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        try {
          const filePath = join(server.config.root, 'public', 'data', 'superadmin-usage.json');
          const stat = statSync(filePath);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            ok: true,
            mtime: stat.mtimeMs,
            size: stat.size,
            productionWritesEnabled: false,
          }));
        } catch {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, productionWritesEnabled: false }));
        }
      });

      server.middlewares.use('/api/superadmin-usage/sync', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        if (blockNonLocal(req, res)) return;
        const child = spawn('node', [join(server.config.root, 'sync', 'superadmin-usage.mjs')], {
          cwd: server.config.root,
          env: process.env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => { stdout += c.toString(); });
        child.stderr.on('data', (c) => { stderr += c.toString(); });
        const timeout = setTimeout(() => child.kill(), 120_000);
        child.on('close', (code) => {
          clearTimeout(timeout);
          let mtime = null;
          try { mtime = statSync(join(server.config.root, 'public', 'data', 'superadmin-usage.json')).mtimeMs; } catch { /* not written yet */ }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: code === 0, code, stdout: stdout.slice(-2000), stderr: stderr.slice(-500), mtime }));
        });
        child.on('error', (err) => {
          clearTimeout(timeout);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      });

      server.middlewares.use('/api/sync', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (blockNonLocal(req, res)) return;
        const started = startSyncRun({
          repoRoot: server.config.root,
          node: process.execPath,
          trigger: 'dashboard-dev',
          env: process.env,
        });
        res.statusCode = started.accepted ? 202 : 409;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          ok: started.accepted,
          accepted: started.accepted,
          busy: started.busy,
          run_id: started.run_id,
          status: started.snapshot,
        }));
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
