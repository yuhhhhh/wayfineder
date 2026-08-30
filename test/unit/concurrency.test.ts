import { describe, expect, it } from "vitest";
import { BoundedSemaphore, CapacityError, KeyedSerialQueue } from "../../src/shared/concurrency.js";

describe("concurrency controls", () => {
  it("never exceeds the configured active count when handing a slot to a waiter", async () => {
    const semaphore = new BoundedSemaphore(1, 4);
    let active = 0;
    let maximumObserved = 0;
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const operation = async (gate?: Promise<void>) =>
      semaphore.run(async () => {
        active += 1;
        maximumObserved = Math.max(maximumObserved, active);
        await gate;
        await Promise.resolve();
        active -= 1;
      });

    const first = operation(firstGate);
    const second = operation();
    releaseFirst?.();
    const third = operation();
    await Promise.all([first, second, third]);
    expect(maximumObserved).toBe(1);
  });

  it("rejects work beyond the configured queue bound", async () => {
    const semaphore = new BoundedSemaphore(1, 0);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = semaphore.run(() => gate);
    await expect(semaphore.run(async () => undefined)).rejects.toBeInstanceOf(CapacityError);
    release?.();
    await active;
  });

  it("serializes the same key while allowing different keys to overlap", async () => {
    const queue = new KeyedSerialQueue();
    const order: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.run("same", async () => {
      order.push("same:first:start");
      await gate;
      order.push("same:first:end");
    });
    const second = queue.run("same", async () => order.push("same:second"));
    const other = queue.run("other", async () => order.push("other"));
    await other;
    release?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["same:first:start", "other", "same:first:end", "same:second"]);
  });
});
