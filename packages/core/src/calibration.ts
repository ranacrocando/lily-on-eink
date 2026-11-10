import { pageSizeMm, type DeviceSpec } from './devices.js';

export const CALIBRATION_SENTENCE = 'If you can see all four border lines and the 0 marks, the whole page is visible.';
export const CALIBRATION_HINT =
  'If a border line is cut off, look at the small ruler in the middle of that edge: ' +
  'the first mark you can see tells you how many mm are hidden.';

/** Staff size the file sets explicitly; one markup unit is a staff space of this size. */
const STAFF_SIZE_PT = 20;
/** LilyPond's pt is 1/72.27 in. */
const MM_PER_PT = 25.4 / 72.27;
/** A staff space is a quarter of the staff size. */
const MM_PER_UNIT = (STAFF_SIZE_PT / 4) * MM_PER_PT;

/** A spacing alist that puts the markup flush against the page edges. */
const ZERO_SPACING = String.raw`#'((basic-distance . 0) (minimum-distance . 0) (padding . 0) (stretchability . 0))`;
/**
 * The markup is declared this much shorter than the page: a markup exactly as tall as the page
 * makes LilyPond warn that the page is over-full (and compress it by 0.0). The drawing is
 * translated down by the same amount, so that it still lines up with the page.
 */
const HEIGHT_SLACK_MM = 0.05;

// Line widths.
const BORDER_MM = 0.3;
const TICK_WIDTH_MM = 0.2;
const GRID_WIDTH_MM = 0.12;
const GRID_GREY = 0.72;

// Edge ticks: every mm, longer every 5 mm and every 10 mm. Labels every 10 mm.
const TICK_MM = 1.1;
const TICK_5_MM = 2.2;
const TICK_10_MM = 3.5;
/** Distance from the edge to the label row. */
const EDGE_LABEL_GAP_MM = 3.8;
/** Distance from the edge of the left/right labels' anchor, so that they clear the 10 mm ticks. */
const SIDE_LABEL_INSET_MM = 3.8;
/** An edge label that would not fit this close to the far end of its edge is left out. */
const LABEL_END_CLEARANCE_MM = 6;
const LABEL_PT = 7;

// Depth rulers.
const RULER_DEPTH_MM = 10;
const RULER_TICK_HALF_MM = 1.2;
const RULER_LONG_TICK_HALF_MM = 2;
const RULER_LABEL_PT = 6;
/** Gap between a ruler and its digits. */
const RULER_LABEL_GAP_MM = 2.4;
/** Clearance kept between an edge label and a depth ruler. */
const RULER_CLEARANCE_MM = 0.5;

// Device data and sentences, centred on the page.
const NAME_PT = 13;
const NAME_MIN_PT = 7;
const DATA_PT = 10;
const BODY_PT = 8;
/** Average glyph width relative to the font size, for the (bold) name and the body text. */
const NAME_EM = 0.62;
const BODY_EM = 0.52;
/** Line pitch relative to the font size. */
const PITCH = 0.55;
const PARAGRAPH_GAP_MM = 3;
/** Never wider than this, and always this far from both page edges. */
const INFO_MAX_WIDTH_MM = 100;
const INFO_SIDE_MARGIN_MM = 15;

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
  if (mm % 10 === 0) return TICK_10_MM;
  if (mm % 5 === 0) return TICK_5_MM;
  return TICK_MM;
}

/** Estimated width in mm of `chars` characters at `pt`. */
const textWidthMm = (chars: number, pt: number, em: number): number => chars * em * pt * MM_PER_PT;

/**
 * Greedy word wrap into balanced lines: the line count is the minimum for `maxChars`, and the
 * target width is spread evenly, so there is no short last line.
 */
export function wrapWords(s: string, maxChars: number): string[] {
  const words = s.split(' ');
  const fill = (limit: number): string[] => {
    const lines: string[] = [];
    for (const word of words) {
      const last = lines.at(-1);
      if (last !== undefined && last.length + 1 + word.length <= limit) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines;
  };
  const count = Math.ceil(s.length / maxChars);
  // Start at an even split and widen until the words fit into the minimum number of lines.
  for (let limit = Math.ceil(s.length / count); limit < maxChars; limit++) {
    const lines = fill(limit);
    if (lines.length <= count) return lines;
  }
  return fill(maxChars);
}

interface Page {
  w: number;
  h: number;
  /** x of the ruler on the top and bottom edge, y (from the top) of the ruler on the left and right edge. */
  rulerX: number;
  rulerY: number;
}

/** Light 10 mm grid. */
function gridPart({ w, h }: Page): string {
  const lines: string[] = [];
  for (let x = 10; x < w; x += 10) lines.push(box(x - GRID_WIDTH_MM / 2, 0, x + GRID_WIDTH_MM / 2, h));
  for (let y = 10; y < h; y += 10) lines.push(box(0, h - y - GRID_WIDTH_MM / 2, w, h - y + GRID_WIDTH_MM / 2));
  const grey = `${GRID_GREY} ${GRID_GREY} ${GRID_GREY}`;
  return String.raw`\with-color #(rgb-color ${grey}) \overlay { ${lines.join(' ')} }`;
}

/** Border exactly on the page edge. */
function borderPart({ w, h }: Page): string[] {
  return [box(0, 0, w, BORDER_MM), box(0, h - BORDER_MM, w, h), box(0, 0, BORDER_MM, h), box(w - BORDER_MM, 0, w, h)];
}

/** True if the label at `from`..`to` (mm along the edge) touches the zone of a depth ruler. */
function touchesRuler(from: number, to: number, ruler: number, below: number, above: number): boolean {
  return to >= ruler - below - RULER_CLEARANCE_MM && from <= ruler + above + RULER_CLEARANCE_MM;
}

/**
 * Ticks every mm, perpendicular to the edge, running inward, and labels every 10 mm (counted
 * from the top left corner). There is no label 0: each depth ruler carries the 0 of its edge.
 * A label that would touch a depth ruler or run past the far end is left out.
 */
function tickParts({ w, h, rulerX, rulerY }: Page): string[] {
  const parts: string[] = [];
  const labelH = digitHeightMm(LABEL_PT);
  const digitW = textWidthMm(1, LABEL_PT, BODY_EM);
  const rulerLabelW = textWidthMm(2, RULER_LABEL_PT, BODY_EM);
  // Ruler zone along the edge: ticks and digits of the top and bottom rulers.
  const xBelow = RULER_LONG_TICK_HALF_MM;
  const xAbove = RULER_LABEL_GAP_MM + 0.2 + rulerLabelW;
  // Ruler zone of the left and right rulers: ticks, and the digits below them.
  const yBelow = RULER_LONG_TICK_HALF_MM;
  const yAbove = RULER_LABEL_GAP_MM + digitHeightMm(RULER_LABEL_PT) + RULER_LONG_TICK_HALF_MM / 2;

  for (let p = 0; p <= w + 1e-9; p++) {
    const len = tickLength(p);
    const x0 = Math.max(0, p - TICK_WIDTH_MM / 2);
    const x1 = Math.min(w, p + TICK_WIDTH_MM / 2);
    parts.push(box(x0, h - len, x1, h), box(x0, 0, x1, len));
    const digits = String(p).length;
    const from = p + 0.5;
    if (p > 0 && p % 10 === 0 && p <= w - LABEL_END_CLEARANCE_MM) {
      if (touchesRuler(from, from + digits * digitW, rulerX, xBelow, xAbove)) continue;
      parts.push(text(from, h - EDGE_LABEL_GAP_MM - labelH, LABEL_PT, 'left', String(p)));
      parts.push(text(from, EDGE_LABEL_GAP_MM, LABEL_PT, 'left', String(p)));
    }
  }
  for (let p = 0; p <= h + 1e-9; p++) {
    const len = tickLength(p);
    const y0 = Math.max(0, h - p - TICK_WIDTH_MM / 2);
    const y1 = Math.min(h, h - p + TICK_WIDTH_MM / 2);
    parts.push(box(0, y0, len, y1), box(w - len, y0, w, y1));
    if (p > 0 && p % 10 === 0 && p <= h - 4) {
      // Measured down from the top: the label sits just below the tick.
      if (touchesRuler(p + 0.5, p + 0.5 + labelH, rulerY, yBelow, yAbove)) continue;
      const y = h - p - labelH - 0.5;
      parts.push(text(SIDE_LABEL_INSET_MM, y, LABEL_PT, 'left', String(p)));
      parts.push(text(w - SIDE_LABEL_INSET_MM, y, LABEL_PT, 'right', String(p)));
    }
  }
  return parts;
}

/**
 * Depth rulers in the middle of each edge, 0 to 10 mm: their ticks run along the edge, so the
 * first mark that is visible is the depth the reader hides. The 0 sits on the border and is the
 * only "0" of its edge; marks 0, 5 and 10 are labelled.
 */
function rulerParts({ w, h, rulerX, rulerY }: Page): string[] {
  const parts: string[] = [];
  const digitH = digitHeightMm(RULER_LABEL_PT);
  const t = TICK_WIDTH_MM / 2;
  for (let d = 0; d <= RULER_DEPTH_MM; d++) {
    const half = d % 5 === 0 ? RULER_LONG_TICK_HALF_MM : RULER_TICK_HALF_MM;
    // The mark at depth 0 lies on the border; keep its box inside the page.
    const a = Math.max(0, d - t);
    const b = d + t;
    parts.push(
      box(rulerX - half, h - b, rulerX + half, h - a),
      box(rulerX - half, a, rulerX + half, b),
      box(a, h - rulerY - half, b, h - rulerY + half),
      box(w - b, h - rulerY - half, w - a, h - rulerY + half),
    );
    if (d % 5 !== 0) continue;
    const s = String(d);
    // At depth 0 the digit sits just inside the border instead of straddling it.
    const along = d === 0 ? BORDER_MM + 0.3 : d;
    const down = h - rulerY - RULER_LABEL_GAP_MM - digitH;
    const baseline = d === 0 ? BORDER_MM + 0.3 : d - digitH / 2;
    parts.push(
      text(
        rulerX + RULER_LABEL_GAP_MM + 0.2,
        h - (d === 0 ? baseline + digitH : d + digitH / 2),
        RULER_LABEL_PT,
        'left',
        s,
      ),
      text(rulerX + RULER_LABEL_GAP_MM + 0.2, baseline, RULER_LABEL_PT, 'left', s),
      d === 0 ? text(along, down, RULER_LABEL_PT, 'left', s) : text(d, down, RULER_LABEL_PT, 'center', s),
      d === 0 ? text(w - along, down, RULER_LABEL_PT, 'right', s) : text(w - d, down, RULER_LABEL_PT, 'center', s),
    );
  }
  return parts;
}

/**
 * Device data and the two sentences, centred, on a white box so that the grid does not cross
 * the text. The name is shrunk to fit; it must only contain glyphs of LilyPond's bundled fonts
 * (anything else, e.g. CJK, aborts the engine). A newline in the name becomes a space.
 */
function infoPart({ w, h }: Page, device: DeviceSpec): string {
  const cx = w / 2;
  const width = Math.min(w - 2 * INFO_SIDE_MARGIN_MM, INFO_MAX_WIDTH_MM);
  const name = device.name.replace(/\s+/g, ' ').trim();
  const namePt = Math.max(
    NAME_MIN_PT,
    Math.min(NAME_PT, NAME_PT * (width / textWidthMm(name.length, NAME_PT, NAME_EM))),
  );

  // Lines top down: text, size, bold, extra gap before.
  const items: { s: string; pt: number; bold: boolean; gap: number }[] = [
    { s: name, pt: namePt, bold: true, gap: 0 },
    { s: `${num(pageSizeMm(device).width)} x ${num(pageSizeMm(device).height)} mm`, pt: DATA_PT, bold: false, gap: 0 },
    { s: `${device.widthPx} x ${device.heightPx} px`, pt: DATA_PT, bold: false, gap: 0 },
    { s: `${num(device.ppi)} ppi`, pt: DATA_PT, bold: false, gap: 0 },
  ];
  const maxChars = Math.floor(width / textWidthMm(1, BODY_PT, BODY_EM));
  for (const paragraph of [CALIBRATION_SENTENCE, CALIBRATION_HINT]) {
    wrapWords(paragraph, maxChars).forEach((s, i) => {
      items.push({ s, pt: BODY_PT, bold: false, gap: i === 0 ? PARAGRAPH_GAP_MM : 0 });
    });
  }

  const pitch = (pt: number): number => pt * PITCH;
  const total = items.reduce((sum, it) => sum + it.gap + pitch(it.pt), 0);
  let y = h / 2 + total / 2;
  const lines = items.map((it) => {
    y -= it.gap + pitch(it.pt);
    return text(cx, y, it.pt, 'center', it.s, it.bold);
  });
  return String.raw`\whiteout \overlay { ${lines.join(' ')} }`;
}

/**
 * A standalone LilyPond file with one page of the device's exact size, for checking how much
 * of the page the reader shows: a border on the page edge, 1 mm ticks along all four edges
 * (labelled every 10 mm, counted from the top left corner), a depth ruler in the middle of
 * each edge, a light 10 mm grid and the device data in the centre. Drawn with markup commands.
 * `lilypondVersion` is the engine's dotted version number, e.g. "2.26.0".
 */
export function calibrationSource(device: DeviceSpec, lilypondVersion: string): string {
  if (!/^\d+(\.\d+)+$/.test(lilypondVersion)) throw new Error(`Invalid LilyPond version "${lilypondVersion}"`);
  const { width: w, height: h } = pageSizeMm(device);
  const page: Page = {
    w,
    h,
    rulerX: Math.floor(w / 20) * 10 + 5,
    rulerY: Math.floor(h / 20) * 10 + 5,
  };
  // Back to front: the grid first, so that everything else paints over it.
  const parts = [gridPart(page), ...borderPart(page), ...tickParts(page), ...rulerParts(page), infoPart(page, device)];

  return [
    String.raw`\version "${lilypondVersion}"`,
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
    String.raw`\markup \with-dimensions #'(0 . ${unit(w)}) #'(0 . ${unit(h - HEIGHT_SLACK_MM)}) \translate #'(0 . -${unit(HEIGHT_SLACK_MM)}) \overlay {`,
    ...parts.map((p) => `  ${p}`),
    String.raw`}`,
    '',
  ].join('\n');
}
