export class Mutex {
    _locked = false;
    _queue = [];
    async runExclusive(fn) {
        await this.acquire();
        try {
            return await fn();
        }
        finally {
            this.release();
        }
    }
    acquire() {
        if (!this._locked) {
            this._locked = true;
            return Promise.resolve();
        }
        return new Promise((resolve) => this._queue.push(resolve));
    }
    release() {
        const next = this._queue.shift();
        if (next)
            next();
        else
            this._locked = false;
    }
    get locked() {
        return this._locked;
    }
}
