#!/usr/bin/env node
// Authenticode-sign the Windows installers of a published GitHub release and
// keep the updater metadata consistent.
//
// Signing changes the .exe bytes, so this also regenerates the .exe.blockmap
// files, rewrites the sha512/size entries in latest.yml, and rewrites the
// affected SHA256SUMS lines. Signing itself is delegated to the maintainer's
// `sign-windows` command (Certum SimplySign via PKCS#11; see SECURITY.md).
//
// Usage: node scripts/sign-windows-release.mjs <tag> [--upload] [--work-dir DIR]
//
// Without --upload nothing on GitHub is modified: everything is prepared and
// verified in <work-dir>/new for review. With --upload the changed assets are
// replaced in the order blockmaps, installers, latest.yml, SHA256SUMS, then
// re-downloaded and checked. Originals are kept in <work-dir>/orig.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = 'grognard-xml/grognard';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const upload = args.includes('--upload');
const workFlag = args.indexOf('--work-dir');
const tag = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--work-dir');
if (!tag || !/^v\d/.test(tag)) {
  throw new Error('Usage: sign-windows-release.mjs <tag> [--upload] [--work-dir DIR]');
}
const version = tag.slice(1);
const workDir =
  workFlag >= 0 ? path.resolve(args[workFlag + 1]) : mkdtempSync(path.join(tmpdir(), 'sign-win-'));
const origDir = path.join(workDir, 'orig');
const newDir = path.join(workDir, 'new');
mkdirSync(origDir, { recursive: true });
mkdirSync(newDir, { recursive: true });

const run = (cmd, cmdArgs, options = {}) =>
  execFileSync(cmd, cmdArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });
const gh = (...ghArgs) => run('gh', [...ghArgs, '-R', REPO]);
const sha = (algorithm, file, encoding) =>
  createHash(algorithm).update(readFileSync(file)).digest(encoding);
const log = (message) => process.stdout.write(`${message}\n`);

for (const tool of ['gh', 'sign-windows', 'osslsigncode']) {
  try {
    run('which', [tool]);
  } catch {
    throw new Error(`Required tool not found on PATH: ${tool}`);
  }
}

const appBuilder = (() => {
  const dir = path.join(root, 'node_modules', 'app-builder-bin');
  const candidates = {
    darwin: [`mac/app-builder_${process.arch === 'arm64' ? 'arm64' : 'amd64'}`],
    linux: [`linux/${process.arch}/app-builder`],
  }[process.platform];
  const found = (candidates ?? []).map((c) => path.join(dir, c)).find((c) => existsSync(c));
  if (!found) throw new Error('app-builder binary not found; run npm install in the repo root');
  return found;
})();

log(`Downloading ${tag} Windows assets to ${origDir}`);
gh(
  'release',
  'download',
  tag,
  '--dir',
  origDir,
  '--clobber',
  '-p',
  'Grognard-win-Setup-*',
  '-p',
  'latest.yml',
  '-p',
  'SHA256SUMS',
);

const installers = readdirSync(origDir)
  .filter((n) => /^Grognard-win-Setup-.*\.exe$/.test(n))
  .sort();
if (installers.length !== 2) throw new Error(`Expected 2 installers, found ${installers.length}`);
for (const name of installers) {
  if (!name.includes(version)) throw new Error(`${name} does not match version ${version}`);
}

// Refuse to continue if the release does not match its own checksums, or if
// an installer is already signed (re-signing would stack signatures).
const sums = readFileSync(path.join(origDir, 'SHA256SUMS'), 'utf8').trimEnd().split('\n');
const listed = new Map(sums.map((line) => line.split(/\s+/)).map(([hash, name]) => [name, hash]));
for (const name of [...installers, 'latest.yml', ...installers.map((n) => `${n}.blockmap`)]) {
  if (listed.get(name) !== sha('sha256', path.join(origDir, name), 'hex')) {
    throw new Error(`${name} does not match SHA256SUMS; refusing to continue`);
  }
}
for (const name of installers) {
  try {
    run('osslsigncode', [
      'extract-signature',
      '-in',
      path.join(origDir, name),
      '-out',
      path.join(workDir, 'probe.sig'),
    ]);
    throw new Error(`${name} is already signed; nothing to do`);
  } catch (error) {
    if (error.message.includes('already signed')) throw error;
  }
}

for (const name of installers) {
  log(`\nSigning ${name}`);
  run(
    'sign-windows',
    ['--force', '-n', 'Grognard', '-o', path.join(newDir, name), path.join(origDir, name)],
    {
      stdio: 'inherit',
    },
  );
  run(appBuilder, [
    'blockmap',
    '-i',
    path.join(newDir, name),
    '-o',
    path.join(newDir, `${name}.blockmap`),
  ]);
}

// latest.yml: swap sha512 and size for each installer, leave everything else as is.
let yml = readFileSync(path.join(origDir, 'latest.yml'), 'utf8');
for (const name of installers) {
  const before = path.join(origDir, name);
  const after = path.join(newDir, name);
  const oldHash = sha('sha512', before, 'base64');
  if (!yml.includes(oldHash)) throw new Error(`latest.yml has no sha512 entry for ${name}`);
  yml = yml.split(oldHash).join(sha('sha512', after, 'base64'));
  const oldSize = `size: ${readFileSync(before).length}`;
  if (!yml.includes(oldSize)) throw new Error(`latest.yml has no size entry for ${name}`);
  yml = yml.replace(oldSize, `size: ${readFileSync(after).length}`);
}
writeFileSync(path.join(newDir, 'latest.yml'), yml);

// SHA256SUMS: rewrite only the lines whose files changed.
const changed = readdirSync(newDir).filter((n) => n !== 'SHA256SUMS');
writeFileSync(
  path.join(newDir, 'SHA256SUMS'),
  `${sums
    .map((line) => {
      const [, name] = line.split(/\s+/);
      return changed.includes(name)
        ? `${sha('sha256', path.join(newDir, name), 'hex')}  ${name}`
        : line;
    })
    .join('\n')}\n`,
);

log('\nChanges prepared in ' + newDir);
for (const name of ['latest.yml', 'SHA256SUMS']) {
  try {
    run('diff', ['-u', path.join(origDir, name), path.join(newDir, name)]);
  } catch (error) {
    log(error.stdout);
  }
}

const verify = () => {
  const bundle = path.join(process.env.HOME, '.config/sign-windows/ca/verify-bundle.pem');
  for (const name of installers) {
    const target = path.join(newDir, name);
    run('osslsigncode', ['verify', '-CAfile', bundle, '-TSA-CAfile', bundle, '-in', target]);
    const expected = new RegExp(`url: ${name}\\n\\s+sha512: (\\S+)`).exec(yml)?.[1];
    if (expected !== sha('sha512', target, 'base64'))
      throw new Error(`latest.yml mismatch: ${name}`);
  }
};
verify();
log('Staged signatures verified and latest.yml matches the signed installers.');

if (!upload) {
  log(
    `\nDry run: nothing uploaded. Re-run with --upload to publish (originals are in ${origDir}).`,
  );
  process.exit(0);
}

const order = [
  ...changed.filter((n) => n.endsWith('.blockmap')),
  ...changed.filter((n) => n.endsWith('.exe')),
  'latest.yml',
  'SHA256SUMS',
];
for (const name of [...new Set(order)]) {
  log(`Uploading ${name}`);
  gh('release', 'upload', tag, path.join(newDir, name), '--clobber');
}

const liveDir = path.join(workDir, 'live');
mkdirSync(liveDir, { recursive: true });
gh(
  'release',
  'download',
  tag,
  '--dir',
  liveDir,
  '--clobber',
  ...[...new Set(order)].flatMap((n) => ['-p', n]),
);
for (const name of new Set(order)) {
  if (
    sha('sha256', path.join(liveDir, name), 'hex') !== sha('sha256', path.join(newDir, name), 'hex')
  ) {
    throw new Error(`Live ${name} differs from the staged file`);
  }
}
log(`\nUploaded and verified. Originals kept in ${origDir}.`);
