/** Local ownership shared by signer instances for the same chain and account. */
const pending = new Map<string, Promise<void>>();

export async function withUserTransaction<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = pending.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  pending.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (pending.get(key) === current) pending.delete(key);
  }
}
