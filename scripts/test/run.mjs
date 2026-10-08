// Runs every *.test.ts file under packages/ via Node's built-in test
// runner (node --test), with the alias loader registered so @ikigai/*
// imports and extensionless relative imports resolve. No test
// framework dependency — Node 22+ strips TS types natively; the loader
// in this directory is the only piece that was actually missing.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

function findTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (entry.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

const testFiles = findTestFiles(path.join(root, 'packages'));
if (testFiles.length === 0) {
  console.log('No *.test.ts files found under packages/.');
  process.exit(0);
}

console.log(`Running ${testFiles.length} test file(s)...\n`);

const result = spawnSync(
  process.execPath,
  ['--import', path.join(root, 'scripts/test/register.mjs'), '--test', ...testFiles],
  { stdio: 'inherit', cwd: root },
);

process.exit(result.status ?? 1);
