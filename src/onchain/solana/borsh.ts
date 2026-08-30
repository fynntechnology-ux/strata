/**
 * A minimal Borsh writer/reader.
 *
 * Anchor serialises instruction arguments and account data with Borsh. We only
 * need a handful of primitives, so rather than depend on `@coral-xyz/anchor`
 * (which pulls a large Node-oriented tree into a browser bundle) this covers
 * the exact set STRATA's instructions use.
 *
 * Borsh rules that matter here:
 *   - integers are little-endian, fixed width
 *   - bool is a single byte, 0 or 1
 *   - Option<T> is a 1-byte tag then the value
 *   - Vec<T> and String are a u32 length then the elements/UTF-8 bytes
 *   - Pubkey is 32 raw bytes, no length prefix
 */

export class BorshWriter {
  #chunks: Uint8Array[] = [];
  #length = 0;

  #push(bytes: Uint8Array): this {
    this.#chunks.push(bytes);
    this.#length += bytes.length;
    return this;
  }

  u8(value: number): this {
    return this.#push(new Uint8Array([value & 0xff]));
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  u16(value: number): this {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, value, true);
    return this.#push(buf);
  }

  u32(value: number): this {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value, true);
    return this.#push(buf);
  }

  i16(value: number): this {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setInt16(0, value, true);
    return this.#push(buf);
  }

  u64(value: bigint): this {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, value, true);
    return this.#push(buf);
  }

  i64(value: bigint): this {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigInt64(0, value, true);
    return this.#push(buf);
  }

  bytes(value: Uint8Array): this {
    return this.#push(value);
  }

  /** Fixed-size byte array, e.g. `[u8; 32]`. No length prefix. */
  fixed(value: Uint8Array, size: number): this {
    if (value.length !== size) {
      throw new Error(`Expected ${size} bytes, received ${value.length}`);
    }
    return this.#push(value);
  }

  string(value: string): this {
    const encoded = new TextEncoder().encode(value);
    this.u32(encoded.length);
    return this.#push(encoded);
  }

  option<T>(value: T | null | undefined, write: (writer: this, value: T) => void): this {
    if (value === null || value === undefined) return this.u8(0);
    this.u8(1);
    write(this, value);
    return this;
  }

  vec<T>(values: readonly T[], write: (writer: this, value: T) => void): this {
    this.u32(values.length);
    for (const value of values) write(this, value);
    return this;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.#length);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

export class BorshReader {
  #view: DataView;
  #offset = 0;

  constructor(private readonly data: Uint8Array) {
    this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get offset(): number {
    return this.#offset;
  }

  skip(bytes: number): this {
    this.#offset += bytes;
    return this;
  }

  u8(): number {
    return this.#view.getUint8(this.#offset++);
  }

  bool(): boolean {
    return this.u8() === 1;
  }

  u16(): number {
    const value = this.#view.getUint16(this.#offset, true);
    this.#offset += 2;
    return value;
  }

  i16(): number {
    const value = this.#view.getInt16(this.#offset, true);
    this.#offset += 2;
    return value;
  }

  u32(): number {
    const value = this.#view.getUint32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  u64(): bigint {
    const value = this.#view.getBigUint64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  i64(): bigint {
    const value = this.#view.getBigInt64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  fixed(size: number): Uint8Array {
    const value = this.data.subarray(this.#offset, this.#offset + size);
    this.#offset += size;
    return value;
  }

  string(): string {
    const length = this.u32();
    const value = new TextDecoder().decode(this.data.subarray(this.#offset, this.#offset + length));
    this.#offset += length;
    return value;
  }

  option<T>(read: (reader: this) => T): T | null {
    return this.u8() === 1 ? read(this) : null;
  }

  vec<T>(read: (reader: this) => T): T[] {
    const length = this.u32();
    const out: T[] = [];
    for (let i = 0; i < length; i++) out.push(read(this));
    return out;
  }
}
