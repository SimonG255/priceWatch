import { getCurrentUserEmail } from "./current-user";

export function isAdminEmail(email: string | null) {
  if (!email) return false;
  const configured = (process.env.ADMIN_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  return configured.includes(email.toLowerCase());
}

export async function getAdminEmail() {
  const email = await getCurrentUserEmail();
  return isAdminEmail(email) ? email : null;
}
