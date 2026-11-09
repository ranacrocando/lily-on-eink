import devices from './presets/devices.json' with { type: 'json' };

export interface SafeAreaMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DeviceSpec {
  id: string;
  name: string;
  widthPx: number;
  heightPx: number;
  ppi: number;
  safeAreaMm: SafeAreaMm;
  staffSizeAdjust: number;
  source: string;
}

const DEVICES: readonly DeviceSpec[] = devices;

export function listDevices(): readonly DeviceSpec[] {
  return DEVICES;
}

/** Resolve a preset id, or pass a custom DeviceSpec through unchanged. */
export function getDevice(idOrSpec: string | DeviceSpec): DeviceSpec {
  if (typeof idOrSpec !== 'string') return idOrSpec;
  const found = DEVICES.find((d) => d.id === idOrSpec);
  if (!found) {
    throw new Error(`Unknown device "${idOrSpec}". Valid ids: ${DEVICES.map((d) => d.id).join(', ')}`);
  }
  return found;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function pageSizeMm(device: DeviceSpec): { width: number; height: number } {
  return {
    width: round2((device.widthPx / device.ppi) * 25.4),
    height: round2((device.heightPx / device.ppi) * 25.4),
  };
}
