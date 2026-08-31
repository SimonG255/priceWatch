export const DATABASE_DEADLINE_MS = 10_000;

export async function withDatabaseDeadline<T>(operation: PromiseLike<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${DATABASE_DEADLINE_MS / 1_000} seconds.`)),
          DATABASE_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function isDatabaseTimeout(error: unknown) {
  return error instanceof Error && error.message.includes("timed out after");
}
