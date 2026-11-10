import { OVERLAY_ILY } from './overlay-sources.js';
import type { SafeAreaMm } from './devices.js';

export interface WrapperOptions {
  mainBasename: string;
  pageMm: { width: number; height: number };
  marginsMm: SafeAreaMm;
  staffSize: number;
  keepTagline: boolean;
  lilypondVersion: string;
  /** Test only: raw lines appended to the \paper block. Not exposed through convert(). */
  extraPaper?: string;
}

export interface Wrapper {
  source: string;
  overlay: { name: 'lily-on-eink.ily'; content: string };
}

// Known slice limits (to be fixed in the hardening plan):
// - custom page headers and footers (odd/even Header/FooterMarkup) and a user's
//   bookTitleMarkup (also `= ##f`) are replaced by the overlay's markups.
// Deliberately no set-paper-size (it would rescale margins and indent from A4)
// and no indent override.

/**
 * Extra left margin (mm) on top of the profile margin. LilyPond draws system-start brackets,
 * braces and bar numbers to the left of the staff start, i.e. inside `left-margin`. Measured
 * on the corpus at 3 mm margin, they reached the page edge.
 */
export const SYSTEM_START_ALLOWANCE_MM = 3;

/** Format with at most 2 decimals, locale independent. */
function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function escapeLilyString(s: string): string {
  return s.split('\\').join('\\\\').split('"').join('\\"');
}

export function buildWrapper(opts: WrapperOptions): Wrapper {
  const m = opts.marginsMm;
  const left = m.left + SYSTEM_START_ALLOWANCE_MM;
  const lines = [
    String.raw`\version "${escapeLilyString(opts.lilypondVersion)}"`,
    String.raw`\include "lily-on-eink.ily"`,
    // Device settings for the overlay's book handler, which re-applies them to the paper of
    // every \book and \bookpart (their own \paper blocks included) just before it is printed.
    String.raw`#(lily-on-eink:configure! '((paper-width . ${num(opts.pageMm.width)}) (paper-height . ${num(opts.pageMm.height)})`,
    String.raw`  (top-margin . ${num(m.top)}) (bottom-margin . ${num(m.bottom)}) (left-margin . ${num(left)}) (right-margin . ${num(m.right)})`,
    String.raw`  (staff-size . ${num(opts.staffSize)}) (keep-tagline . ${opts.keepTagline ? '#t' : '#f'})))`,
    String.raw`\include "${escapeLilyString(opts.mainBasename)}"`,
    String.raw`\paper {`,
    String.raw`  paper-width = ${num(opts.pageMm.width)}\mm`,
    String.raw`  paper-height = ${num(opts.pageMm.height)}\mm`,
    String.raw`  top-margin = ${num(m.top)}\mm`,
    String.raw`  bottom-margin = ${num(m.bottom)}\mm`,
    String.raw`  left-margin = ${num(left)}\mm`,
    String.raw`  right-margin = ${num(m.right)}\mm`,
    String.raw`  ragged-last-bottom = ##t`,
    String.raw`  print-page-number = ##f`,
    // Title, header and footer markups from the overlay. They are set here, in the \paper block
    // that follows the user's include, because this block is the last write to the default
    // paper: it beats both LilyPond's defaults and title, header or footer markups from the
    // user's own top-level \paper. The overlay is read before the user's file, so it can only
    // define them.
    String.raw`  bookTitleMarkup = \lilyOnEinkBookTitleMarkup`,
    String.raw`  scoreTitleMarkup = \lilyOnEinkScoreTitleMarkup`,
    String.raw`  oddHeaderMarkup = \lilyOnEinkPageHeaderMarkup`,
    String.raw`  evenHeaderMarkup = \lilyOnEinkPageHeaderMarkup`,
    String.raw`  oddFooterMarkup = \lilyOnEinkFooterMarkup`,
    String.raw`  evenFooterMarkup = \lilyOnEinkFooterMarkup`,
    ...(opts.extraPaper !== undefined ? [`  ${opts.extraPaper}`] : []),
    String.raw`}`,
    String.raw`#(set-global-staff-size ${num(opts.staffSize)})`,
  ];
  if (!opts.keepTagline) lines.push(String.raw`\header { tagline = ##f }`);
  return {
    source: lines.join('\n') + '\n',
    overlay: { name: 'lily-on-eink.ily', content: OVERLAY_ILY },
  };
}
