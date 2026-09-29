import { deflateSync } from "node:zlib";

/**
 * Un PNG a partir de píxeles RGB, sin dependencias.
 *
 * Estela no tiene dependencias en tiempo de ejecución a propósito (ver el
 * README), y para un recibo de colores planos no hace falta más que esto: la
 * cabecera, los píxeles comprimidos con el zlib de Node y el cierre, cada
 * trozo con su CRC. Nada de paletas ni transparencia.
 */

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLA[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/** Lienzo RGB: `set` pinta un píxel, `png` lo codifica. */
export class Lienzo {
  readonly pixels: Uint8Array;

  constructor(readonly width: number, readonly height: number, fondo: readonly [number, number, number]) {
    this.pixels = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) this.pixels.set(fondo, i * 3);
  }

  set(x: number, y: number, color: readonly [number, number, number]): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels.set(color, (y * this.width + x) * 3);
  }

  rect(x: number, y: number, w: number, h: number, color: readonly [number, number, number]): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
  }

  png(): Buffer {
    const cabecera = Buffer.alloc(13);
    cabecera.writeUInt32BE(this.width, 0);
    cabecera.writeUInt32BE(this.height, 4);
    cabecera[8] = 8;  // bits por canal
    cabecera[9] = 2;  // RGB
    // 10, 11, 12: compresión, filtro y entrelazado, todos 0.

    // Cada fila empieza por el tipo de filtro; 0 = sin filtro. Con colores
    // planos, deflate ya comprime las filas repetidas de sobra.
    const fila = this.width * 3;
    const crudo = Buffer.alloc((fila + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      crudo[y * (fila + 1)] = 0;
      crudo.set(this.pixels.subarray(y * fila, (y + 1) * fila), y * (fila + 1) + 1);
    }

    return Buffer.concat([
      FIRMA,
      trozo("IHDR", cabecera),
      trozo("IDAT", deflateSync(crudo, { level: 9 })),
      trozo("IEND", Buffer.alloc(0)),
    ]);
  }
}
