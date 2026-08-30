export class CapacityError extends Error {
  constructor(message = "Service capacity is currently exhausted") {
    super(message);
    this.name = "CapacityError";
  }
}

export class BoundedSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maximum: number,
    private readonly maximumQueued: number,
  ) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error("maximum must be a positive integer");
    if (!Number.isInteger(maximumQueued) || maximumQueued < 0) {
      throw new Error("maximumQueued must be a non-negative integer");
    }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maximum) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= this.maximumQueued) throw new CapacityError();
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.active -= 1;
  }
}

export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
