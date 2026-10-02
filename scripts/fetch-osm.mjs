/** Acquire pinned OSM, Overture, Sentinel and DSM sources without runtime keys. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const python = process.env.BEIJING_DATA_PYTHON || path.resolve('.venv-data/bin/python');
const only = process.argv[2];
const result = spawnSync(python, ['scripts/fetch-geospatial.py', ...(only ? ['--only', only] : [])], { stdio: 'inherit' });
if (result.error) console.error('Install requirements-data.txt into .venv-data before fetching:', result.error.message);
process.exit(result.status ?? 1);
