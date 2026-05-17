import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const workdir = mkdtempSync(join(tmpdir(), 'dataflows-pack-'));
const tarball = execFileSync('npm', ['pack'], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();
const tarballPath = join(root, tarball);

writeFileSync(join(workdir, 'package.json'), JSON.stringify({ name: 'install-fixture', private: true, type: 'module' }, null, 2));
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', tarballPath], { cwd: workdir, stdio: 'inherit' });

const script = `
import {
  validateDataflow, prepareDataflow, executeDataflow,
  DataflowCompileError, DataflowRuntimeError,
  formatDataflowDiagnostics, formatDataflowRuntimeError
} from '@processengine/dataflows';

// minimal smoke: validate → prepare → execute with stub registry
const source = {
  id: 'dataflow.smoke.test',
  version: '1.0.0',
  schema: {
    '$.context.data.facts.smokeResult': { title: 'Smoke result', description: 'Facts produced by the pack/install smoke test.', fields: { ok: { type: 'boolean', title: 'Smoke check passed', description: 'true when the smoke mapping returns a successful result.' } } }
  },
  pipeline: [
    {
      id: 'map_smoke',
      type: 'MAPPINGS',
      kind: 'facts',
      artefactId: 'mappings.smoke',
      contract: {
        input: { ref: '$.context.input.application' },
        output: { ref: '$.context.data.facts.smokeResult' }
      }
    }
  ]
};

const v = validateDataflow(source);
if (!v.ok) throw new Error('validate failed: ' + formatDataflowDiagnostics(v.diagnostics));

const artifact = prepareDataflow(source);
if (artifact.artifactType !== 'dataflow') throw new Error('wrong artifactType');
if (artifact.writeSet[0] !== '$.context.data.facts.smokeResult') throw new Error('wrong writeSet');

// execute with stub registry
const stubArtifact = { kind: 'stub' };
const registries = {
  mappings: {
    get: () => stubArtifact,
    executeMappings: () => ({ output: { ok: true } }),
  }
};
const result = executeDataflow(artifact, { state: { context: { input: { application: { x: 1 } } } }, registries });
if (!result.writes || result.writes.length !== 1) throw new Error('wrong writes');
if (result.writes[0].value.ok !== true) throw new Error('wrong write value');
console.log('pack smoke ok');
`;

writeFileSync(join(workdir, 'check.mjs'), script);
execFileSync('node', ['check.mjs'], { cwd: workdir, stdio: 'inherit' });
