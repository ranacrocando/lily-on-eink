import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkText } from '../../../scripts/privacy-check.mjs';

// Every forbidden input is built at runtime so this file contains no literal.
const winHome = 'C:' + '\\' + 'Us' + 'ers' + '\\someone\\x';
const winHomeSlash = 'C:' + '/' + 'Us' + 'ers' + '/someone';
const nixHome = '/' + 'home' + '/a/b';
const macHome = '/' + 'Us' + 'ers' + '/a/b';
const fileUrl = 'file:' + '///C:/x';
const backtickPath = '`' + '/' + 'home' + '/x`';
const email = 'x' + '@' + 'example.org';

const rules = (text: string, denylist: string[] = []) =>
  checkText(text, { denylist }).map((f) => f.rule);

describe('privacy checkText', () => {
  it.each([winHome, winHomeSlash, nixHome, macHome, fileUrl])('flags absolute path %#', (p) => {
    expect(rules(`see ${p}`)).toContain('abs-path');
  });

  it('flags a path inside Markdown inline code', () => {
    expect(rules(`see ${backtickPath}`)).toContain('abs-path');
  });

  it('skipPathAndEmail still reports denylist but not abs-path or email', () => {
    const text = `${nixHome} ${email} secret corp`;
    expect(checkText(text, { denylist: ['secret corp'], skipPathAndEmail: true }).map((f) => f.rule)).toEqual(['denylist']);
  });

  it('CLI never prints the matched denylist text', () => {
    const term = 'check' + 'Text'; // appears in scripts/privacy-check.mjs content, not in any path
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    const r = spawnSync(process.execPath, ['scripts/privacy-check.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PRIVACY_DENYLIST: term, CI: '', IS_FORK: '' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('denylist');
    expect((r.stdout + r.stderr).toLowerCase()).not.toContain(term.toLowerCase());
  });

  it('flags a path at line start', () => {
    expect(rules(nixHome)).toContain('abs-path');
  });

  it('flags private emails', () => {
    expect(rules(`mail ${email}`)).toEqual(['email']);
  });

  it('matches denylist entries case-insensitively and reports the line', () => {
    expect(checkText('ok\nthe secret corp is here', { denylist: ['Secret Corp'] })).toEqual([
      { rule: 'denylist', line: 2 },
    ]);
  });

  it.each([
    '179312672+ranacrocando@users.noreply.github.com',
    'noreply@github.com',
    'support@github.com',
    '49699333+dependabot[bot]@users.noreply.github.com',
    'foo@1.2.3',
    'actions/checkout@v4.1.1',
  ])('allows %s', (t) => {
    expect(rules(t)).toEqual([]);
  });
});
