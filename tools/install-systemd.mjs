#!/usr/bin/env node

// Node cannot load the TypeScript installer on older runtimes, so this tiny
// dependency-free bootstrap provides the required actionable version refusal.
const minimum = [22, 19, 0];
const actual = process.versions.node.split('.').map((part) => Number(part));
let supported = true;
for (let index = 0; index < minimum.length; index += 1) {
  if (!Number.isFinite(actual[index]) || actual[index] < minimum[index]) {
    supported = false;
    break;
  }
  if (actual[index] > minimum[index]) break;
}

if (!supported) {
  console.error(`Pop Agent systemd installation requires Node 22.19.0 or newer; found ${process.versions.node}.`);
  process.exitCode = 1;
} else {
  const { runInstallCli } = await import('./install-systemd.ts');
  await runInstallCli();
}
