export function authorizeCronRequest(request: Request, secret = process.env.CRON_SECRET) {
  if (!secret || secret.length < 16) {
    return { authorized: false as const, status: 503, error: "CRON_SECRET must be configured with at least 16 characters." };
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return { authorized: false as const, status: 401, error: "Unauthorized." };
  }
  return { authorized: true as const };
}
