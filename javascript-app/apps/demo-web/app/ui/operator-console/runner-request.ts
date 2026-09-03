export const runnerRequestTimeoutMs = 10_000;

// Keep the deadline active through the response body, not only the headers.
export async function requestRunnerJson(
  url: string,
  init?: RequestInit,
  timeoutMs = runnerRequestTimeoutMs,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload: unknown = await response.json().catch((error: unknown) => {
      if (response.ok || controller.signal.aborted) throw error;
      return null;
    });
    return { response, payload };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Runner request timed out. Check the runner and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
