import { getCurrentUserEmail } from "./current-user";

function configuredEmails(name: "ADMIN_EMAILS" | "SUPER_ADMIN_EMAILS") {
  return (process.env[name] ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
}

export function isSuperAdminEmail(email: string | null) {
  return Boolean(email && configuredEmails("SUPER_ADMIN_EMAILS").includes(email.toLowerCase()));
}

export function isAdminEmail(email: string | null) {
  if (!email) return false;
  return isSuperAdminEmail(email) || configuredEmails("ADMIN_EMAILS").includes(email.toLowerCase());
}

export async function getAdminEmail() {
  const email = await getCurrentUserEmail();
  return isAdminEmail(email) ? email : null;
}

export async function getSuperAdminEmail() {
  const email = await getCurrentUserEmail();
  return isSuperAdminEmail(email) ? email : null;
}
