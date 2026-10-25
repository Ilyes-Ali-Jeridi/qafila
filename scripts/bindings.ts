/**
 * Regenerates packages/contract-client from the built wasm, then patches the
 * generated package.json so the workspace can import the TypeScript source.
 * Usage: pnpm bindings  (after `stellar contract build` in contracts/)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const wasm = resolve(root, 'contracts/target/wasm32v1-none/release/qafila_deals.wasm');
const out = resolve(root, 'packages/contract-client');

execSync(`stellar contract bindings typescript --wasm "${wasm}" --output-dir "${out}" --overwrite`, {
  stdio: 'inherit',
});

const pkgPath = resolve(out, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
pkg['name'] = '@qafila/contract-client';
pkg['version'] = '0.1.0';
pkg['private'] = true;
pkg['exports'] = { '.': './src/index.ts' };
delete pkg['typings'];
pkg['scripts'] = { typecheck: 'tsc --noEmit' };
pkg['dependencies'] = { '@stellar/stellar-sdk': '^17.4.0', buffer: '6.0.3' };
pkg['devDependencies'] = { typescript: '^5.9.0' };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

writeFileSync(
  resolve(out, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: '../../tsconfig.base.json',
      compilerOptions: { noEmit: true, types: ['node'], noImplicitOverride: false }, // generated code
      include: ['src'],
    },
    null,
    2,
  ) + '\n',
);
console.log('bindings regenerated and package.json patched');
