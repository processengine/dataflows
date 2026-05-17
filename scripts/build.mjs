import { mkdir, rm, cp, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = resolve(root, 'dist');
const typesFile = resolve(root, 'types', 'index.d.ts');

// Fail-fast: types must exist before build
try {
  await access(typesFile);
} catch {
  console.error('ERROR: types/index.d.ts is missing. Types are required for build.');
  process.exit(1);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, 'src'), dist, { recursive: true });
await cp(typesFile, resolve(dist, 'index.d.ts'));
console.log('build ok');
