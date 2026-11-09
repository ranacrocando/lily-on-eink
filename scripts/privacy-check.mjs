// Privacy check: no absolute local paths, private emails or denylisted terms in files or commit metadata.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ABS_PATH = [
  /[A-Za-z]:[\\/]+Users[\\/]/i,
  /(^|[\s"'(=:])\/(home|Users)\/[^\s/]+/,
  /file:\/\/\/?([A-Za-z]:|home\/|Users\/)/i,
];
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[A-Za-z]{2,}\b/g;
const ALLOWED_EMAILS = new Set([
  '179312672+ranacrocando@users.noreply.github.com',
  'noreply@github.com',
  'support@github.com',
]);
const isAllowedEmail = (e) => ALLOWED_EMAILS.has(e) || e.endsWith('[bot]@users.noreply.github.com');

/**
 * @param {string} text
 * @param {{ denylist?: string[], skipPathAndEmail?: boolean }} [opts]
 * @returns {{ rule: string, line: number }[]}
 */
export function checkText(text, { denylist = [], skipPathAndEmail = false } = {}) {
  const findings = [];
  const entries = denylist.map((d) => d.trim().toLowerCase()).filter(Boolean);
  text.split(/\r?\n/).forEach((line, i) => {
    const n = i + 1;
    if (!skipPathAndEmail) {
      if (ABS_PATH.some((re) => re.test(line))) findings.push({ rule: 'abs-path', line: n });
      if ([...line.matchAll(EMAIL)].some((m) => !isAllowedEmail(m[0]))) findings.push({ rule: 'email', line: n });
    }
    const lower = line.toLowerCase();
    if (entries.some((d) => lower.includes(d))) findings.push({ rule: 'denylist', line: n });
  });
  return findings;
}

const BINARY = /\.(png|pdf|wasm|tgz|zip|otf|ttf|woff2)$/i;
const ALLOWLISTED = /^(corpus\/|docs\/|LICENSE$|packages\/[^/]+\/LICENSE$|scripts\/privacy-check\.mjs$)/;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

function loadDenylist() {
  const parts = [process.env.PRIVACY_DENYLIST ?? ''];
  if (existsSync('.privacy-denylist')) parts.push(readFileSync('.privacy-denylist', 'utf8'));
  return parts.join('\n').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function main() {
  const history = process.argv.includes('--history');
  const isFork = process.env.IS_FORK === 'true';
  let denylist = loadDenylist();
  if (isFork) {
    console.log('notice: fork PR, denylist check skipped');
    denylist = [];
  } else if (process.env.CI === 'true' && denylist.length === 0) {
    console.error('PRIVACY_DENYLIST secret missing');
    process.exit(1);
  }

  const out = [];
  for (const path of git('ls-files', '-z').split('\0').filter(Boolean)) {
    if (BINARY.test(path) || !existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const f of checkText(text, { denylist, skipPathAndEmail: ALLOWLISTED.test(path) })) {
      out.push(`${path}:${f.line} ${f.rule}`);
    }
  }

  let range = [];
  if (!history) {
    try {
      git('rev-parse', '--verify', '--quiet', 'origin/main');
      range = ['origin/main..HEAD'];
    } catch {
      range = [];
    }
  }
  const raw = git('log', ...range, '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e');
  for (const rec of raw.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean)) {
    const [sha, an, ae, cn, ce, body] = rec.split('\x1f');
    const rules = new Set(checkText([an, ae, cn, ce, body].join('\n'), { denylist }).map((f) => f.rule));
    for (const rule of rules) out.push(`commit ${sha} ${rule}`);
  }

  if (out.length) {
    console.error(out.join('\n'));
    console.error(`privacy check failed: ${out.length} finding(s)`);
    process.exit(1);
  }
  console.log('privacy check passed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
