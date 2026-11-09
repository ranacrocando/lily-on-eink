export interface BookOutput {
  bookIndex: number;
  pdf?: Uint8Array;
  pngPages: Uint8Array[];
}

export interface GroupedOutputs {
  books: BookOutput[];
  unrecognized: string[];
}

const PDF = /^score(?:-(\d+))?\.pdf$/;
const PNG = /^score(?:-(\d+))?(?:-page(\d+))?\.png$/;

/** Groups engine output files (name to bytes) into books. Unknown names are reported, not dropped silently. */
export function groupOutputs(files: Record<string, Uint8Array>): GroupedOutputs {
  const books = new Map<number, { pdf?: Uint8Array; pages: Map<number, Uint8Array> }>();
  const unrecognized: string[] = [];
  const book = (i: number) => {
    let b = books.get(i);
    if (!b) books.set(i, (b = { pages: new Map() }));
    return b;
  };
  for (const [name, bytes] of Object.entries(files)) {
    const pdf = PDF.exec(name);
    const png = pdf ? null : PNG.exec(name);
    if (pdf) book(pdf[1] ? Number(pdf[1]) : 0).pdf = bytes;
    else if (png) book(png[1] ? Number(png[1]) : 0).pages.set(png[2] ? Number(png[2]) : 1, bytes);
    else unrecognized.push(name);
  }
  const result: BookOutput[] = [...books.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bookIndex, b]) => {
      const out: BookOutput = {
        bookIndex,
        pngPages: [...b.pages.entries()].sort(([x], [y]) => x - y).map(([, v]) => v),
      };
      if (b.pdf) out.pdf = b.pdf;
      return out;
    });
  return { books: result, unrecognized };
}

const MAX_NAME_LENGTH = 150;

// eslint-disable-next-line no-control-regex
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const clean = (s: string) => s.replace(UNSAFE, '_');
const trimEnd = (s: string) => s.replace(/[. ]+$/, '');

/** Builds a FAT32-safe PDF file name of at most 150 characters. */
export function outputFileName(
  title: string | undefined,
  basename: string,
  deviceName: string,
  bookIndex: number,
): string {
  const fallback = (basename.split(/[\\/]/).pop() ?? basename).replace(/\.[^.]*$/, '');
  const base = clean(title && title.trim() !== '' ? title : fallback);
  const book = bookIndex > 0 ? ` (${bookIndex + 1})` : '';
  const tail = `${book} – ${clean(deviceName)}.pdf`;
  const room = Math.max(0, MAX_NAME_LENGTH - tail.length);
  const head = trimEnd(base.slice(0, room));
  return `${head}${tail}`;
}
