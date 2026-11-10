import { pageSizeMm, type DeviceSpec } from './devices.js';

export const CALIBRATION_SENTENCE = 'If you can see all four border lines and the 0 marks, the whole page is visible.';

/** Staff size the file sets explicitly; one markup unit is a staff space of this size. */
const STAFF_SIZE_PT = 20;
/** LilyPond's pt is 1/72.27 in; a staff space is a quarter of the staff size. */
const MM_PER_UNIT = ((STAFF_SIZE_PT / 4) * 25.4) / 72.27;
const MM_PER_PT = 25.4 / 72.27;

/** A spacing alist that puts the markup flush against the page edges. */
const ZERO_SPACING = String.raw`#'((basic-distance . 0) (minimum-distance . 0) (padding . 0) (stretchability . 0))`;

const BORDER_MM = 0.3;
const TICK_WIDTH_MM = 0.2;
const GRID_WIDTH_MM = 0.12;
const GRID_GREY = 0.72;

const LABEL_PT = 7;
const DEPTH_LABEL_PT = 6;
/** Height of a digit, about 0.7 em. */
const digitHeightMm = (pt: number): number => pt * 0.7 * MM_PER_PT;

/** Format with at most 3 decimals, locale independent. */
function num(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Markup units (staff spaces) for a length in mm. */
function unit(mm: number): string {
  return num(mm / MM_PER_UNIT);
}

function escapeLilyString(s: string): string {
  return s.split('\\').join('\\\\').split('"').join('\\"');
}

/** A filled rectangle between two corners given in mm, origin bottom left, y up. */
function box(x0: number, y0: number, x1: number, y1: number): string {
  return String.raw`\filled-box #'(${unit(x0)} . ${unit(x1)}) #'(${unit(y0)} . ${unit(y1)}) #0`;
}

type Anchor = 'left' | 'center' | 'right';

/** A text line with its baseline at (x, y) mm. The anchor picks which point of the text sits at x. */
function text(x: number, y: number, ptSize: number, anchor: Anchor, s: string, bold = false): string {
  const align = { left: '', center: String.raw`\center-align `, right: String.raw`\right-align ` }[anchor];
  const body = `${bold ? String.raw`\bold ` : ''}"${escapeLilyString(s)}"`;
  return String.raw`\translate #'(${unit(x)} . ${unit(y)}) \abs-fontsize #${num(ptSize)} ${align}${body}`;
}

/** Tick length in mm by position: longer every 5 mm and again every 10 mm. */
function tickLength(mm: number): number {
  if (mm % 10 === 0) return 3.5;
  if (mm % 5 === 0) return 2.2;
  return 1.1;
}

/**
 * A standalone LilyPond file with one page of the device's exact size, for checking how much
 * of the page the reader shows: a border on the page edge, 1 mm ticks along all four edges
 * (labelled every 10 mm, counted from the top left corner), a depth ruler in the middle of
 * each edge, a light 10 mm grid and the device data in the centre. Drawn with markup commands.
 */
export function calibrationSource(device: DeviceSpec, lilypondVersion: string): string {
  const { width: w, height: h } = pageSizeMm(device);
  const parts: string[] = [];

  // Light 10 mm grid first, so everything else paints over it.
  const grid: string[] = [];
  for (let x = 10; x < w; x += 10) grid.push(box(x - GRID_WIDTH_MM / 2, 0, x + GRID_WIDTH_MM / 2, h));
  for (let y = 10; y < h; y += 10) grid.push(box(0, h - y - GRID_WIDTH_MM / 2, w, h - y + GRID_WIDTH_MM / 2));
  const grey = `${GRID_GREY} ${GRID_GREY} ${GRID_GREY}`;
  parts.push(String.raw`\with-color #(rgb-color ${grey}) \overlay { ${grid.join(' ')} }`);

  // Border exactly on the page edge.
  parts.push(
    box(0, 0, w, BORDER_MM),
    box(0, h - BORDER_MM, w, h),
    box(0, 0, BORDER_MM, h),
    box(w - BORDER_MM, 0, w, h),
  );

  // Ticks every mm, perpendicular to the edge, running inward; labels every 10 mm.
  const labelGap = 3.8;
  const labelH = digitHeightMm(LABEL_PT);
  // Depth rulers sit in the middle of each edge, on a 5 mm position between two labels.
  const rulerX = Math.floor(w / 20) * 10 + 5;
  const rulerY = Math.floor(h / 20) * 10 + 5;
  for (let p = 0; p <= w + 1e-9; p++) {
    const len = tickLength(p);
    const x0 = Math.max(0, p - TICK_WIDTH_MM / 2);
    const x1 = Math.min(w, p + TICK_WIDTH_MM / 2);
    parts.push(box(x0, h - len, x1, h), box(x0, 0, x1, len));
    if (p % 10 === 0 && p <= w - 6) {
      parts.push(text(Math.max(p + 0.5, 2.6), h - labelGap - labelH, LABEL_PT, 'left', String(p)));
      parts.push(text(Math.max(p + 0.5, 2.6), labelGap, LABEL_PT, 'left', String(p)));
    }
  }
  for (let p = 0; p <= h + 1e-9; p++) {
    const len = tickLength(p);
    const y0 = Math.max(0, h - p - TICK_WIDTH_MM / 2);
    const y1 = Math.min(h, h - p + TICK_WIDTH_MM / 2);
    parts.push(box(0, y0, len, y1), box(w - len, y0, w, y1));
    if (p % 10 === 0 && p > 0 && p <= h - 4) {
      const y = h - p - labelH - 0.5;
      parts.push(text(labelGap, y, LABEL_PT, 'left', String(p)));
      parts.push(text(w - labelGap, y, LABEL_PT, 'right', String(p)));
    }
  }

  // Depth rulers, 1 to 10 mm from each edge: their ticks run along the edge, so the mark where
  // the reader's bezel starts is the depth that is hidden.
  const depthH = digitHeightMm(DEPTH_LABEL_PT);
  const t = TICK_WIDTH_MM / 2;
  for (let d = 1; d <= 10; d++) {
    const half = d % 5 === 0 ? 2 : 1.2;
    parts.push(
      box(rulerX - half, h - d - t, rulerX + half, h - d + t),
      box(rulerX - half, d - t, rulerX + half, d + t),
      box(d - t, h - rulerY - half, d + t, h - rulerY + half),
      box(w - d - t, h - rulerY - half, w - d + t, h - rulerY + half),
    );
    if (d % 5 === 0) {
      parts.push(
        text(rulerX + 2.6, h - d - depthH / 2, DEPTH_LABEL_PT, 'left', String(d)),
        text(rulerX + 2.6, d - depthH / 2, DEPTH_LABEL_PT, 'left', String(d)),
        text(d, h - rulerY - 2.4 - depthH, DEPTH_LABEL_PT, 'center', String(d)),
        text(w - d, h - rulerY - 2.4 - depthH, DEPTH_LABEL_PT, 'center', String(d)),
      );
    }
  }

  // Device data, centred.
  const cx = w / 2;
  const lines: [string, number, boolean][] = [
    [device.name, 13, true],
    [`${num(w)} x ${num(h)} mm`, 10, false],
    [`${device.widthPx} x ${device.heightPx} px`, 10, false],
    [`${num(device.ppi)} ppi`, 10, false],
  ];
  let y = h / 2 + 12;
  const infoLines: string[] = [];
  for (const [s, pt, bold] of lines) {
    infoLines.push(text(cx, y, pt, 'center', s, bold));
    y -= pt * 0.55;
  }
  // The sentence, wrapped here (about 1.45 mm per character at 8 pt) and centred line by line.
  const maxChars = Math.floor(Math.min(w - 30, 100) / 1.45);
  let line = '';
  for (const word of CALIBRATION_SENTENCE.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > maxChars) {
      infoLines.push(text(cx, y - 6, 8, 'center', line));
      y -= 4.4;
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  infoLines.push(text(cx, y - 6, 8, 'center', line));
  parts.push(String.raw`\whiteout \overlay { ${infoLines.join(' ')} }`);

  return [
    String.raw`\version "${escapeLilyString(lilypondVersion)}"`,
    String.raw`\header { tagline = ##f }`,
    String.raw`#(set-global-staff-size ${STAFF_SIZE_PT})`,
    String.raw`\paper {`,
    String.raw`  paper-width = ${num(w)}\mm`,
    String.raw`  paper-height = ${num(h)}\mm`,
    String.raw`  top-margin = 0\mm`,
    String.raw`  bottom-margin = 0\mm`,
    String.raw`  left-margin = 0\mm`,
    String.raw`  right-margin = 0\mm`,
    String.raw`  print-page-number = ##f`,
    String.raw`  top-markup-spacing = ${ZERO_SPACING}`,
    String.raw`  markup-system-spacing = ${ZERO_SPACING}`,
    String.raw`  last-bottom-spacing = ${ZERO_SPACING}`,
    String.raw`  oddHeaderMarkup = ##f`,
    String.raw`  evenHeaderMarkup = ##f`,
    String.raw`  oddFooterMarkup = ##f`,
    String.raw`  evenFooterMarkup = ##f`,
    String.raw`}`,
    String.raw`\markup \with-dimensions #'(0 . ${unit(w)}) #'(0 . ${unit(h)}) \overlay {`,
    ...parts.map((p) => `  ${p}`),
    String.raw`}`,
    '',
  ].join('\n');
}
