import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

rmSync(resolve(pkgRoot, 'dist'), { recursive: true, force: true });
rmSync(resolve(pkgRoot, 'tsconfig.build.tsbuildinfo'), { force: true });

execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.build.json'], {
  cwd: pkgRoot,
  stdio: 'inherit',
});