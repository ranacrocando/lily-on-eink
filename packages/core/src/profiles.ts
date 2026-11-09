import profiles from './presets/profiles.json' with { type: 'json' };
import type { DeviceSpec, SafeAreaMm } from './devices.js';

export interface Profile {
  id: string;
  name: string;
  staffSize: number;
  marginMm: number;
}

const PROFILES: readonly Profile[] = profiles;

export function listProfiles(): readonly Profile[] {
  return PROFILES;
}

export function getProfile(idOrProfile: string | Profile): Profile {
  if (typeof idOrProfile !== 'string') return idOrProfile;
  const found = PROFILES.find((p) => p.id === idOrProfile);
  if (!found) {
    throw new Error(`Unknown profile "${idOrProfile}". Valid ids: ${PROFILES.map((p) => p.id).join(', ')}`);
  }
  return found;
}

export function effectiveStaffSize(profile: Profile, device: DeviceSpec, override?: number): number {
  return override ?? profile.staffSize + device.staffSizeAdjust;
}

export function effectiveMarginsMm(profile: Profile, device: DeviceSpec): SafeAreaMm {
  const s = device.safeAreaMm;
  const m = profile.marginMm;
  return { top: m + s.top, right: m + s.right, bottom: m + s.bottom, left: m + s.left };
}
