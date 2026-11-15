import { Duplex } from 'node:stream';
import { Socket } from 'node:net';

export type DbLinkPgReceiveFacts = { maxReceiveBytes: number; receivedBytes: number; forwardedBytes: number; maxReadBytes: number; rejected: boolean; closed: boolean };
export class DbLinkPgTransportError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'DbLinkPgTransportError'; this.code = code; }
}
const READ_BYTES = 16 * 1024;

/** Host-owned TCP transport supplied through pg's public stream factory. No PostgreSQL frames are interpreted. */
export class DbLinkPgStream extends Duplex {
  readonly completion: Promise<Readonly<DbLinkPgReceiveFacts>>;
  readonly #socket: Socket;
  readonly #maxReceiveBytes: number;
  #receivedBytes = 0;
  #forwardedBytes = 0;
  #maxReadBytes = 0;
  #rejected = false;
  #socketClosed = false;
  #finish!: (facts: Readonly<DbLinkPgReceiveFacts>) => void;

  constructor(maxReceiveBytes: number) {
    super({ readableHighWaterMark: READ_BYTES, writableHighWaterMark: READ_BYTES });
    if (!Number.isSafeInteger(maxReceiveBytes) || maxReceiveBytes <= 0) throw new DbLinkPgTransportError('db_receive_budget_invalid');
    this.#maxReceiveBytes = maxReceiveBytes;
    this.completion = new Promise(resolve => { this.#finish = resolve; });
    this.#socket = new Socket({ onread: { buffer: Buffer.alloc(READ_BYTES), callback: (count, buffer) => {
      if (this.destroyed) return false;
      this.#maxReadBytes = Math.max(this.#maxReadBytes, count);
      this.#receivedBytes += count;
      if (count > this.#maxReceiveBytes - this.#forwardedBytes) {
        this.#rejected = true;
        this.destroy(new DbLinkPgTransportError('db_receive_budget_exhausted'));
        return false;
      }
      this.#forwardedBytes += count;
      // onread reuses its fixed buffer. Only admitted bytes are copied, and a
      // false push result pauses native reads until the consumer requests more.
      return this.push(Buffer.from(buffer.subarray(0, count)));
    } } });
    this.#socket.on('connect', () => this.emit('connect'));
    this.#socket.on('error', error => this.destroy(error));
    this.#socket.on('end', () => this.push(null));
    this.#socket.on('close', () => {
      this.#socketClosed = true;
      this.#finish(this.facts);
      if (!this.destroyed) this.destroy();
    });
  }
  get facts(): Readonly<DbLinkPgReceiveFacts> { return Object.freeze({ maxReceiveBytes: this.#maxReceiveBytes, receivedBytes: this.#receivedBytes, forwardedBytes: this.#forwardedBytes, maxReadBytes: this.#maxReadBytes, rejected: this.#rejected, closed: this.#socketClosed }); }
  get connecting(): boolean { return this.#socket.connecting; }
  connect(port: number, host: string): this { this.#socket.connect(port, host); return this; }
  setNoDelay(enabled = true): this { this.#socket.setNoDelay(enabled); return this; }
  setKeepAlive(enabled = false, initialDelay = 0): this { this.#socket.setKeepAlive(enabled, initialDelay); return this; }
  setTimeout(milliseconds: number, callback?: () => void): this { this.#socket.setTimeout(milliseconds, callback); return this; }
  ref(): this { this.#socket.ref(); return this; }
  unref(): this { this.#socket.unref(); return this; }
  override _read(): void { if (!this.#socket.destroyed) this.#socket.resume(); }
  override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void { this.#socket.write(chunk, encoding, callback); }
  override _final(callback: (error?: Error | null) => void): void { this.#socket.end(callback); }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void { this.#socket.destroy(); callback(error); }
}

/** Immutable total budget for one physical connection; never resets at SQL/batch/transaction boundaries. */
export function createDbLinkPgStream(maxReceiveBytes: number): DbLinkPgStream { return new DbLinkPgStream(maxReceiveBytes); }
