export function isCronRequestAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return true;
  }

  const headerSecret = request.headers.get("x-cron-secret")?.trim();
  if (headerSecret && headerSecret === secret) {
    return true;
  }

  const authorization = request.headers.get("authorization")?.trim();
  if (authorization === `Bearer ${secret}`) {
    return true;
  }

  return false;
}
