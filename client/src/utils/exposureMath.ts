/**
 * Exposure Triangle & Light Metering Mathematics
 */

export function parseShutterToSeconds(shutter: string): number {
  const clean = shutter.replace(/s$/i, '').trim();
  if (clean.includes('/')) {
    const [num, den] = clean.split('/').map(Number);
    if (num && den) return num / den;
  }
  const val = parseFloat(clean);
  return isNaN(val) || val <= 0 ? 1 / 125 : val;
}

export function roundToHalfStop(val: number): number {
  const r = Math.round(val * 2) / 2;
  return Object.is(r, -0) ? 0 : r;
}

export function formatHalfStops(stops: number, includeSign = true): string {
  const rounded = roundToHalfStop(stops);
  if (rounded === 0) return '0 stops';
  const sign = rounded > 0 ? (includeSign ? '+' : '') : '-';
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs);
  const hasHalf = abs - whole >= 0.4;

  let numStr = '';
  if (whole === 0 && hasHalf) {
    numStr = '½';
  } else if (hasHalf) {
    numStr = `${whole}½`;
  } else {
    numStr = `${whole}`;
  }

  const unit = abs === 1 || (whole === 0 && hasHalf) ? 'stop' : 'stops';
  return `${sign}${numStr} ${unit}`;
}

export function computeTargetEv(ev100: number, ratedIso: number, exposureCompEv: number): number {
  const isoShift = Math.log2(Math.max(ratedIso, 6) / 100);
  return ev100 + isoShift - exposureCompEv;
}

/**
 * Computes the exact stop delta between a chosen (shutterSpeed, aperture) pair and the target metered EV.
 * Positive delta = Overexposed (more light hitting the film than metered target).
 * Negative delta = Underexposed (less light hitting the film than metered target).
 */
export function calculateStopDelta(
  shutterSpeed: string,
  aperture: number,
  targetEv: number
): {
  exactDelta: number;
  halfStopDelta: number;
  settingEv: number;
} {
  const sec = parseShutterToSeconds(shutterSpeed);
  const settingEv = Math.log2(Math.pow(aperture, 2) / sec);
  // Lower settingEv means slower shutter or wider aperture -> MORE light (+ stops)
  const exactDelta = targetEv - settingEv;
  return {
    exactDelta: Math.round(exactDelta * 100) / 100,
    halfStopDelta: roundToHalfStop(exactDelta),
    settingEv: Math.round(settingEv * 10) / 10
  };
}

/**
 * Aperture Priority: Given target EV and locked aperture, find the closest mechanical shutter speed.
 */
export function findBestShutterSpeed(params: {
  ev100: number;
  ratedIso: number;
  exposureCompEv: number;
  aperture: number;
  availableShutters: string[];
}): {
  shutterSpeed: string;
  exactSeconds: number;
  stopError: number;
  effectiveEv: number;
} {
  const { ev100, ratedIso, exposureCompEv, aperture, availableShutters } = params;
  const effectiveEv = computeTargetEv(ev100, ratedIso, exposureCompEv);
  const exactSeconds = Math.pow(aperture, 2) / Math.pow(2, effectiveEv);

  const list =
    availableShutters.length > 0
      ? availableShutters
      : ['1/1000', '1/500', '1/250', '1/125', '1/60', '1/30', '1/15'];
  let bestShutter = list[0];
  let bestDiffStops = Infinity;
  let signedStopError = 0;

  for (const s of list) {
    const sec = parseShutterToSeconds(s);
    const diffStops = Math.log2(sec / exactSeconds);
    if (Math.abs(diffStops) < bestDiffStops) {
      bestDiffStops = Math.abs(diffStops);
      bestShutter = s;
      signedStopError = Math.round(diffStops * 10) / 10;
    }
  }

  return {
    shutterSpeed: bestShutter,
    exactSeconds,
    stopError: signedStopError,
    effectiveEv: Math.round(effectiveEv * 10) / 10
  };
}

/**
 * Shutter Priority: Given target EV and locked shutter speed, find the closest lens aperture (f-stop).
 */
export function findBestAperture(params: {
  ev100: number;
  ratedIso: number;
  exposureCompEv: number;
  shutterSpeed: string;
  availableApertures: number[];
}): {
  aperture: number;
  exactAperture: number;
  stopError: number;
  effectiveEv: number;
} {
  const { ev100, ratedIso, exposureCompEv, shutterSpeed, availableApertures } = params;
  const effectiveEv = computeTargetEv(ev100, ratedIso, exposureCompEv);
  const sec = parseShutterToSeconds(shutterSpeed);
  // N = sqrt(t * 2^EV)
  const exactAperture = Math.sqrt(sec * Math.pow(2, effectiveEv));

  const list = availableApertures.length > 0 ? availableApertures : [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
  let bestAperture = list[0];
  let bestDiffStops = Infinity;
  let signedStopError = 0;

  for (const ap of list) {
    // Wider aperture (smaller f-number) = more light (+ stops)
    const diffStops = Math.log2(Math.pow(exactAperture, 2) / Math.pow(ap, 2));
    if (Math.abs(diffStops) < bestDiffStops) {
      bestDiffStops = Math.abs(diffStops);
      bestAperture = ap;
      signedStopError = Math.round(diffStops * 10) / 10;
    }
  }

  return {
    aperture: bestAperture,
    exactAperture: Math.round(exactAperture * 10) / 10,
    stopError: signedStopError,
    effectiveEv: Math.round(effectiveEv * 10) / 10
  };
}

/**
 * Computes EV100 from an average sRGB luminance value (0..255) sampled from the camera canvas,
 * with an optional user calibration offset.
 */
export function luminanceToEv100(avgLuma255: number, calibrationOffsetEv = 0): number {
  const normalized = Math.max(avgLuma255 / 255, 0.002);
  const linear = Math.pow(normalized, 2.2);
  const rawEv = 12.5 + Math.log2(linear / 0.18);
  const clamped = Math.max(1, Math.min(18, rawEv + calibrationOffsetEv));
  return Math.round(clamped * 10) / 10;
}

/**
 * Estimates correlated color temperature (Kelvin) from average R, G, B channel values.
 */
export function estimateColorTempKelvin(avgR: number, avgG: number, avgB: number): number {
  const r = Math.max(1, avgR);
  const b = Math.max(1, avgB);
  const g = Math.max(1, avgG);
  // Simple RB ratio mapping from warm tungsten (2800K) through daylight (5500K) to shade (7500K)
  const rbRatio = b / r;
  const rawK = 5400 * Math.pow(rbRatio, 0.65) + (g - 128) * 1.5;
  const clamped = Math.max(2400, Math.min(9000, rawK));
  return Math.round(clamped / 50) * 50;
}

/**
 * Human-readable lighting condition summary from EV100
 */
export function describeLightLevel(ev100: number): string {
  if (ev100 >= 15.5) return 'Bright Sun / Sand or Snow';
  if (ev100 >= 14.5) return 'Direct Daylight Sun (Sunny 16)';
  if (ev100 >= 13.0) return 'Hazy Sun / Soft Daylight';
  if (ev100 >= 11.5) return 'Overcast / Open Shade';
  if (ev100 >= 9.5) return 'Golden Hour / Deep Shade';
  if (ev100 >= 7.0) return 'Bright Indoor / Neon Street';
  if (ev100 >= 4.5) return 'Dim Ambient / Tungsten Interior';
  return 'Low-Light Night Scene (Check Reciprocity)';
}

/**
 * Zone System helper: returns Zone (I - X) difference between spot luminance and scene average
 */
export function getZoneLabel(evDiff: number): { zone: string; desc: string } {
  const z = Math.round(5 + evDiff);
  if (z <= 2) return { zone: 'Zone II', desc: 'Deep Textured Shadow' };
  if (z === 3) return { zone: 'Zone III', desc: 'Average Dark Materials / Shadow Detail' };
  if (z === 4) return { zone: 'Zone IV', desc: 'Dark Foliage / Open Shadow' };
  if (z === 5) return { zone: 'Zone V', desc: 'Middle Gray (18% Reflectance)' };
  if (z === 6) return { zone: 'Zone VI', desc: 'Light Skin / Stone (+1 Stop)' };
  if (z === 7) return { zone: 'Zone VII', desc: 'Bright Textured Highlight (+2 Stops)' };
  return { zone: 'Zone VIII+', desc: 'Specular / Pure White Highlight' };
}
