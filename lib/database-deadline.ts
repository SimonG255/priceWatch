export const DATABASE_DEADLINE_MS = 10_000;

export async function withDatabaseDeadline<T>(
  operation: PromiseLike<T>,
  label: string,
  deadlineMs = DATABASE_DEADLINE_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${deadlineMs / 1_000} seconds.`)),
          deadlineMs,
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
