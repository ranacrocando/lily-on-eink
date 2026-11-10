import { describe, expect, it } from 'vitest';
import { getDevice, listDevices, pageSizeMm, type DeviceSpec } from '../src/devices.js';

describe('devices', () => {
  it('computes the page size in mm', () => {
    expect(pageSizeMm(getDevice('kobo-sage'))).toEqual({ width: 121.92, height: 162.56 });
  });
it('computes the reMarkable 2 page size', () => {    expect(pageSizeMm(getDevice('remarkable-2'))).toEqual({ width: 157.79, height: 210.39 });  });  it('has portrait orientation for every preset', () => {    for (const d of listDevices()) {      const { width, height } = pageSizeMm(d);      expect(width, d.id).toBeLessThan(height);    }  });
  it('lists the presets', () => {
    expect(listDevices().slice(0, 3).map((d) => d.id)).toEqual(['kobo-sage', 'kobo-clara-bw', 'remarkable-2']);
  });
  it('has sane, sourced values for every preset', () => {
    const ids = new Set<string>();
    for (const d of listDevices()) {
      expect(ids.has(d.id), `duplicate id ${d.id}`).toBe(false);
      ids.add(d.id);
      expect(Number.isInteger(d.widthPx) && d.widthPx > 0, `${d.id} widthPx`).toBe(true);
      expect(Number.isInteger(d.heightPx) && d.heightPx > 0, `${d.id} heightPx`).toBe(true);
      expect(d.widthPx, d.id).toBeLessThan(d.heightPx);
      expect(d.ppi, d.id).toBeGreaterThanOrEqual(150);
      expect(d.ppi, d.id).toBeLessThanOrEqual(400);
      expect(d.source.trim().length, `${d.id} source`).toBeGreaterThan(0);
    }
  });
  it('throws for unknown ids and lists valid ones', () => {
    expect(() => getDevice('nope')).toThrow(/kobo-sage.*kobo-clara-bw.*remarkable-2/);
  });
  it('accepts a custom device object', () => {
    const custom: DeviceSpec = {
      id: 'x', name: 'X', widthPx: 600, heightPx: 800, ppi: 200,
      safeAreaMm: { top: 0, right: 0, bottom: 0, left: 0 }, staffSizeAdjust: 0, source: 'test',
    };
    expect(getDevice(custom)).toBe(custom);
    expect(pageSizeMm(custom)).toEqual({ width: 76.2, height: 101.6 });
  });
});
