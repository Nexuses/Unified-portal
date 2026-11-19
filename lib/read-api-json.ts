export async function readApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Server returned an invalid response (${response.status}). Please refresh and try again.`
    );
  }
  return (await response.json()) as T;
}
