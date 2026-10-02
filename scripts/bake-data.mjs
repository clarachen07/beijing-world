/** Reproducible static-data bake using the isolated geospatial runtime. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const python = process.env.BEIJING_DATA_PYTHON || path.resolve('.venv-data/bin/python');
for (const script of ['scripts/bake-geospatial.py', 'scripts/add-streetlights.py']) {
  const result = spawnSync(python, [script, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) console.error('Install requirements-data.txt into .venv-data before baking:', result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
