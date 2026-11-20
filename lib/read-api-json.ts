function friendlyHttpError(status: number) {
  if (status === 401 || status === 403) {
    return "Your session expired. Please sign in again.";
  }
  if (status === 404) {
    return "That action is not available right now. Refresh the page and try again.";
  }
  if (status >= 500) {
    return "The server hit a problem. Please try again in a moment.";
  }
  return `Server returned an invalid response (${status}). Please refresh and try again.`;
}

/**
 * Parse a portal API response as JSON. Never surfaces raw HTML/`Unexpected token`
 * parse errors in the UI when the server returns an error page.
 */
export async function readApiJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const looksJson =
    contentType.includes("application/json") ||
    text.trimStart().startsWith("{") ||
    text.trimStart().startsWith("[");

  if (!looksJson) {
    throw new Error(friendlyHttpError(response.status));
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(friendlyHttpError(response.status));
  }
}
