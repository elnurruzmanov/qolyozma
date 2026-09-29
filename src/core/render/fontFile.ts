import { parse, type Font } from 'opentype.js'

const WOFF2_SIGNATURE = 0x774f4632 // "wOF2"

/**
 * Parse a TTF/OTF/WOFF/WOFF2 file. opentype.js can't read WOFF2 itself, so WOFF2 is first decompressed
 * to SFNT with a WASM Brotli decoder that is only loaded the first time a WOFF2 file is parsed.
 */
export async function parseFontFile(data: ArrayBuffer | Uint8Array): Promise<Font> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0) === WOFF2_SIGNATURE) {
    const { default: decompress } = await import('woff2-encoder/decompress')
    return parse(toArrayBuffer(await decompress(bytes)))
  }
  return parse(toArrayBuffer(bytes))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
