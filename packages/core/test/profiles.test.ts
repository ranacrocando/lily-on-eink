import { describe, expect, it } from 'vitest';
import { getDevice } from '../src/devices.js';
import { effectiveMarginsMm, effectiveStaffSize, getProfile, listProfiles } from '../src/profiles.js';

describe('profiles', () => {
  it('lists the profiles', () => {
    expect(listProfiles().map((p) => p.id)).toEqual(['generic', 'organ', 'piano', 'leadsheet', 'tab', 'accordion']);
  });
  it('throws for unknown ids', () => {
    expect(() => getProfile('nope')).toThrow(/generic/);
  });
  it('applies the device staff size adjustment', () => {
    expect(effectiveStaffSize(getProfile('organ'), getDevice('kobo-clara-bw'))).toBe(16);
    expect(effectiveStaffSize(getProfile('organ'), getDevice('kobo-sage'))).toBe(17);
  });
  it('lets an explicit override win', () => {
    expect(effectiveStaffSize(getProfile('organ'), getDevice('kobo-clara-bw'), 19)).toBe(19);
  });
  it('adds the safe area to the margin per side', () => {
    const device = { ...getDevice('kobo-sage'), safeAreaMm: { top: 1, right: 2, bottom: 3, left: 4 } };
    expect(effectiveMarginsMm(getProfile('organ'), device)).toEqual({ top: 4, right: 5, bottom: 6, left: 7 });
  });
});
