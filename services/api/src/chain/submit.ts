/** One serialized submit queue per signing key (PLAN 4.4): a venue rush never hits txBAD_SEQ. */
export class SubmitQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  /** Run `fn` after every earlier task for the same key has settled. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.tails.set(key, next.catch(() => undefined));
    return next;
  }
}

export const submitQueue = new SubmitQueue();
