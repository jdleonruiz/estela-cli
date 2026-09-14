/**
 * Escritor de PDF mínimo, sin dependencias.
 *
 * Una factura necesita texto, líneas y alineación a la derecha. Eso cabe en
 * PDF 1.4 con las fuentes base, que todo lector trae incorporadas. La
 * alternativa habitual —arrastrar Puppeteer para imprimir HTML— añade una
 * descarga de Chromium de más de cien megas a una herramienta que presume de
 * instalarse en segundos.
 *
 * Codificación WinAnsi: cubre acentos, eñes y el símbolo del euro, que es
 * exactamente lo que una factura en español necesita.
 */

export type FontName = "Helvetica" | "Helvetica-Bold" | "Courier";

const PAGE_WIDTH = 595.28;   // A4 en puntos
const PAGE_HEIGHT = 841.89;

interface TextOp { kind: "text"; x: number; y: number; text: string; font: FontName; size: number; gray?: number }
interface LineOp { kind: "line"; x1: number; y1: number; x2: number; y2: number; width: number; gray: number }
interface RectOp { kind: "rect"; x: number; y: number; w: number; h: number; gray: number }
type Op = TextOp | LineOp | RectOp;

export class PdfDocument {
  private readonly pages: Op[][] = [[]];
  private current = 0;

  get width(): number { return PAGE_WIDTH; }
  get height(): number { return PAGE_HEIGHT; }
  get pageCount(): number { return this.pages.length; }

  newPage(): void {
    this.pages.push([]);
    this.current = this.pages.length - 1;
  }

  text(x: number, y: number, text: string, font: FontName = "Helvetica", size = 10, gray?: number): void {
    this.pages[this.current]!.push({
      kind: "text", x, y: PAGE_HEIGHT - y, text, font, size,
      ...(gray !== undefined ? { gray } : {}),
    });
  }

  /** Texto alineado a la derecha del borde `x`. */
  textRight(x: number, y: number, text: string, font: FontName = "Helvetica", size = 10, gray?: number): void {
    this.text(x - measure(text, font, size), y, text, font, size, gray);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.75): void {
    this.pages[this.current]!.push({
      kind: "line", x1, y1: PAGE_HEIGHT - y1, x2, y2: PAGE_HEIGHT - y2, width, gray,
    });
  }

  rect(x: number, y: number, w: number, h: number, gray: number): void {
    this.pages[this.current]!.push({ kind: "rect", x, y: PAGE_HEIGHT - y - h, w, h, gray });
  }

  /** Parte un texto en líneas que caben en `maxWidth`. */
  static wrap(text: string, font: FontName, size: number, maxWidth: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, font, size) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      // Una palabra sola más ancha que la caja: se trunca en vez de desbordar.
      line = measure(word, font, size) <= maxWidth ? word : truncate(word, font, size, maxWidth);
    }
    if (line) lines.push(line);
    return lines;
  }

  static truncate(text: string, font: FontName, size: number, maxWidth: number): string {
    return truncate(text, font, size, maxWidth);
  }

  static measure(text: string, font: FontName, size: number): number {
    return measure(text, font, size);
  }

  toBuffer(): Buffer {
    const objects: Buffer[] = [];
    const add = (body: string | Buffer): number => {
      objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
      return objects.length; // los números de objeto empiezan en 1
    };

    // 1: catálogo, 2: árbol de páginas. Se reservan para poder referenciarlos
    // antes de conocer los ids de las páginas.
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add("");

    const fontIds = {
      Helvetica: add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
      "Helvetica-Bold": add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
      Courier: add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"),
    } as const;

    const resources =
      `<< /Font << /F1 ${fontIds.Helvetica} 0 R /F2 ${fontIds["Helvetica-Bold"]} 0 R ` +
      `/F3 ${fontIds.Courier} 0 R >> >>`;

    const pageIds: number[] = [];
    for (const ops of this.pages) {
      const stream = Buffer.from(renderOps(ops), "latin1");
      const contentId = add(Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"),
        stream,
        Buffer.from("\nendstream", "latin1"),
      ]));
      pageIds.push(add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources ${resources} /Contents ${contentId} 0 R >>`));
    }

    objects[1] = Buffer.from(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
      "latin1");

    // Ensamblado con tabla xref.
    const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    let offset = chunks[0]!.length;
    const offsets: number[] = [];

    objects.forEach((body, index) => {
      offsets.push(offset);
      const chunk = Buffer.concat([
        Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
        body,
        Buffer.from("\nendobj\n", "latin1"),
      ]);
      chunks.push(chunk);
      offset += chunk.length;
    });

    const xrefStart = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, "latin1"));

    return Buffer.concat(chunks);
  }
}

const FONT_KEY: Record<FontName, string> = {
  Helvetica: "/F1", "Helvetica-Bold": "/F2", Courier: "/F3",
};

function renderOps(ops: readonly Op[]): string {
  const out: string[] = [];
  let gray = -1;

  for (const op of ops) {
    if (op.kind === "text") {
      const g = op.gray ?? 0;
      if (g !== gray) { out.push(`${g} g`); gray = g; }
      out.push(`BT ${FONT_KEY[op.font]} ${op.size} Tf ${fmt(op.x)} ${fmt(op.y)} Td (${escapeText(op.text)}) Tj ET`);
    } else if (op.kind === "line") {
      if (op.gray !== gray) { out.push(`${op.gray} G`); gray = -1; }
      out.push(`${op.width} w ${fmt(op.x1)} ${fmt(op.y1)} m ${fmt(op.x2)} ${fmt(op.y2)} l S`);
    } else {
      if (op.gray !== gray) { out.push(`${op.gray} g`); gray = op.gray; }
      out.push(`${fmt(op.x)} ${fmt(op.y)} ${fmt(op.w)} ${fmt(op.h)} re f`);
    }
  }
  return out.join("\n");
}

const fmt = (n: number) => n.toFixed(2);

/** Escapa y convierte a WinAnsi. Lo no representable cae a "?" antes que romper el PDF. */
function escapeText(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "(" || char === ")" || char === "\\") { out += `\\${char}`; continue; }
    const code = WINANSI[char] ?? (char.codePointAt(0)! < 128 ? char.codePointAt(0)! : 63);
    out += code < 32 || code > 126 ? `\\${code.toString(8).padStart(3, "0")}` : String.fromCharCode(code);
  }
  return out;
}

/** Caracteres fuera de ASCII que una factura en español necesita. */
const WINANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94,
  "•": 0x95, "–": 0x96, "—": 0x97, "¡": 0xa1, "¢": 0xa2, "£": 0xa3, "¥": 0xa5, "§": 0xa7,
  "©": 0xa9, "ª": 0xaa, "«": 0xab, "°": 0xb0, "±": 0xb1, "º": 0xba, "»": 0xbb, "¿": 0xbf,
  "Á": 0xc1, "Ä": 0xc4, "Ç": 0xc7, "É": 0xc9, "Í": 0xcd, "Ñ": 0xd1, "Ó": 0xd3, "Ö": 0xd6,
  "Ú": 0xda, "Ü": 0xdc, "ß": 0xdf, "á": 0xe1, "â": 0xe2, "ä": 0xe4, "ç": 0xe7, "è": 0xe8,
  "é": 0xe9, "ê": 0xea, "í": 0xed, "ï": 0xef, "ñ": 0xf1, "ó": 0xf3, "ô": 0xf4, "ö": 0xf6,
  "ú": 0xfa, "ü": 0xfc,
};

/**
 * Anchos de las fuentes base, en milésimas de em.
 *
 * Sin esto no hay alineación a la derecha, y una columna de importes desalineada
 * es lo primero que delata una factura hecha a mano.
 */
const HELVETICA: Record<number, number> = buildWidths(
  "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278",  // 32-47
  "556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556",  // 48-63
  "1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778", // 64-79
  "667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556",  // 80-95
  "333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556",  // 96-111
  "556 556 333 500 278 556 500 722 500 500 500 334 260 334 584 350"); // 112-127

const HELVETICA_BOLD: Record<number, number> = buildWidths(
  "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278",
  "556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611",
  "975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778",
  "667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556",
  "333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611",
  "611 611 389 556 333 611 556 778 556 556 500 389 280 389 584 350");

function buildWidths(...rows: readonly string[]): Record<number, number> {
  const widths: Record<number, number> = {};
  rows.forEach((row, rowIndex) => {
    row.split(" ").forEach((value, i) => { widths[32 + rowIndex * 16 + i] = Number(value); });
  });
  return widths;
}

function measure(text: string, font: FontName, size: number): number {
  if (font === "Courier") return text.length * 0.6 * size;

  const table = font === "Helvetica-Bold" ? HELVETICA_BOLD : HELVETICA;
  let width = 0;
  for (const char of text) {
    const code = WINANSI[char] ?? char.codePointAt(0)!;
    // Las vocales acentuadas miden lo mismo que su vocal base en las fuentes
    // base de PDF, así que el fallback es exacto para el español.
    width += table[code] ?? table[BASE_LETTER[char]?.codePointAt(0) ?? 110] ?? 556;
  }
  return (width / 1000) * size;
}

const BASE_LETTER: Record<string, string> = {
  "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n", "ç": "c",
  "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U", "Ü": "U", "Ñ": "N", "Ç": "C",
  "€": "E", "¿": "?", "¡": "!",
};

function truncate(text: string, font: FontName, size: number, maxWidth: number): string {
  const ellipsis = measure("...", font, size);
  let out = "";
  for (const char of text) {
    if (measure(out + char, font, size) + ellipsis > maxWidth) return `${out}...`;
    out += char;
  }
  return out;
}
