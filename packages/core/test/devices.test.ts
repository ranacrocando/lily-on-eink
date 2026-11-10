import { describe, expect, it } from 'vitest';
import { getDevice, listDevices, pageSizeMm, type DeviceSpec } from '../src/devices.js';

describe('devices', () => {
  it('computes the page size in mm', () => {
    expect(pageSizeMm(getDevice('kobo-sage'))).toEqual({ width: 121.92, height: 162.56 });
  });
  it('computes the reMarkable 2 page size', () => {
    expect(pageSizeMm(getDevice('remarkable-2'))).toEqual({ width: 157.79, height: 210.39 });
  });
  it('has portrait orientation for every preset', () => {
    for (const d of listDevices()) {
      const { width, height } = pageSizeMm(d);
      expect(width, d.id).toBeLessThan(height);
    }
  });
  it('lists the presets', () => {
    expect(listDevices().map((d) => d.id)).toEqual(['kobo-sage', 'kobo-clara-bw', 'remarkable-2']);
  });
  it('throws for unknown ids and lists valid ones', () => {
    expect(() => getDevice('nope')).toThrow(/kobo-sage.*kobo-clara-bw.*remarkable-2/);
  });
  it('accepts a custom device object', () => {
    const custom: DeviceSpec = {
      id: 'x',
      name: 'X',
      widthPx: 600,
      heightPx: 800,
      ppi: 200,
      safeAreaMm: { top: 0, right: 0, bottom: 0, left: 0 },
      staffSizeAdjust: 0,
      source: 'test',
    };
    expect(getDevice(custom)).toBe(custom);
    expect(pageSizeMm(custom)).toEqual({ width: 76.2, height: 101.6 });
  });
});
