// Structured JSON logs. Never log message text or secrets.
export function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, service: "bot", msg, ...extra });
  (level === "error" ? console.error : console.log)(line);
}
