export class Mutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this._queue.push(resolve));
  }

  private release() {
    const next = this._queue.shift();
    if (next) next();
    else this._locked = false;
  }

  get locked() {
    return this._locked;
  }
}
