export const APP_TIME_ZONE = "Europe/Ljubljana";

export function formatAppDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: APP_TIME_ZONE,
  }).format(value instanceof Date ? value : new Date(value));
}

export function formatAppTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeStyle: "short",
    timeZone: APP_TIME_ZONE,
  }).format(value instanceof Date ? value : new Date(value));
}
