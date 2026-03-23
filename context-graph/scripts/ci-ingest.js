/**
 * Runs before `next build` on Vercel when using the `vercel-build` script.
 * Loads JSONL into Neon if DATABASE_URL + data folder are available; otherwise skips without failing the build.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveDataDir() {
  if (process.env.O2C_DATA_DIR && String(process.env.O2C_DATA_DIR).trim()) {
    const raw = String(process.env.O2C_DATA_DIR).trim();
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }
  const inApp = path.resolve(__dirname, '..', 'data', 'sap-o2c-data');
  const legacy = path.resolve(__dirname, '..', '..', 'sap-order-to-cash-dataset', 'sap-o2c-data');
  if (fs.existsSync(inApp)) return inApp;
  return legacy;
}

if (process.env.SKIP_INGEST === '1') {
  console.log('[ci-ingest] SKIP_INGEST=1 — skipping Neon ingest.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.warn('[ci-ingest] DATABASE_URL not set — skipping ingest (deploy your app; run ingest locally or set DATABASE_URL on the host).');
  process.exit(0);
}

const dataDir = resolveDataDir();
if (!fs.existsSync(dataDir)) {
  console.warn('[ci-ingest] Data folder missing:', dataDir);
  console.warn('[ci-ingest] Add JSONL under context-graph/data/sap-o2c-data (commit for demo) or set O2C_DATA_DIR. Skipping ingest.');
  process.exit(0);
}

console.log('[ci-ingest] Ingesting from', dataDir, '→ Neon…');
const env = { ...process.env, O2C_DATA_DIR: dataDir };
const r = spawnSync(process.execPath, [path.join(__dirname, 'ingest.js')], {
  stdio: 'inherit',
  env,
});
process.exit(r.status !== 0 ? r.status || 1 : 0);
