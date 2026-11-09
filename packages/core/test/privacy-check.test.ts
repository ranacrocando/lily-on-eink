import { describe, expect, it } from 'vitest';
import { checkText } from '../../../scripts/privacy-check.mjs';

// Every forbidden input is built at runtime so this file contains no literal.
const winHome = 'C:' + '\\' + 'Us' + 'ers' + '\\someone\\x';
const winHomeSlash = 'C:' + '/' + 'Us' + 'ers' + '/someone';
const nixHome = '/' + 'home' + '/a/b';
const macHome = '/' + 'Us' + 'ers' + '/a/b';
const fileUrl = 'file:' + '///C:/x';
const email = 'x' + '@' + 'example.org';

const rules = (text: string, denylist: string[] = []) =>
  checkText(text, { denylist }).map((f) => f.rule);

describe('privacy checkText', () => {
  it.each([winHome, winHomeSlash, nixHome, macHome, fileUrl])('flags absolute path %#', (p) => {
    expect(rules(`see ${p}`)).toContain('abs-path');
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
