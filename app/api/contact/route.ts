const MAX_REQUESTS_PER_HOUR = 5;
const contactAttempts = new Map<string, number[]>();

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().replace(/\r\n?/g, "\n").slice(0, maximum) : "";
}

function allowedRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function withinRateLimit(request: Request) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const cutoff = Date.now() - 60 * 60 * 1000;
  const recent = (contactAttempts.get(address) ?? []).filter((time) => time > cutoff);
  if (recent.length >= MAX_REQUESTS_PER_HOUR) return false;
  recent.push(Date.now());
  contactAttempts.set(address, recent);
  return true;
}

export async function POST(request: Request) {
  if (!allowedRequest(request)) return Response.json({ error: "Invalid contact request." }, { status: 403 });
  if (!withinRateLimit(request)) return Response.json({ error: "Too many messages. Please try again later." }, { status: 429 });

  const webhookUrl = process.env.CONTACT_EMAIL_WEBHOOK_URL?.trim() || process.env.ALERT_EMAIL_WEBHOOK_URL?.trim();
  const contactEmail = process.env.CONTACT_EMAIL?.trim();
  if (!webhookUrl || !contactEmail) {
    return Response.json({ error: "Contact delivery is not configured yet." }, { status: 503 });
  }

  let delivering = false;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (cleanText(body.website, 200)) return Response.json({ message: "Thanks — we’ll be in touch shortly." });
    const name = cleanText(body.name, 100);
    const email = cleanText(body.email, 254).toLowerCase();
    const company = cleanText(body.company, 120);
    const message = cleanText(body.message, 2000);
    const urlCount = Number(body.urlCount);

    if (name.length < 2) throw new Error("Enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid work email.");
    if (company.length < 2) throw new Error("Enter your company name.");
    if (!Number.isInteger(urlCount) || urlCount < 2500 || urlCount > 1_000_000) throw new Error("Enter an estimated URL count of 2,500 or more.");
    if (message.length < 10) throw new Error("Tell us a little more about what you need.");

    delivering = true;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: contactEmail,
        replyTo: email,
        subject: `Nexus Enterprise enquiry — ${company}`,
        text: [`Name: ${name}`, `Email: ${email}`, `Company: ${company}`, `Estimated URLs: ${urlCount.toLocaleString()}`, "", message].join("\n"),
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Contact delivery service rejected the message.");
    return Response.json({ message: "Thanks — we’ll be in touch shortly." });
  } catch (error) {
    const validationError = !delivering;
    console.error("Enterprise contact request failed.", error);
    return Response.json(
      { error: validationError && error instanceof Error ? error.message : "Your message could not be delivered. Please try again later." },
      { status: validationError ? 400 : 502 },
    );
  }
}
