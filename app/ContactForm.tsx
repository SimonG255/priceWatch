"use client";

import { useState } from "react";

type ContactState = "idle" | "sending" | "sent" | "error";

export default function ContactForm() {
  const [state, setState] = useState<ContactState>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error || "Your message could not be sent.");
      form.reset();
      setState("sent");
      setMessage(body.message || "Thanks — we’ll be in touch shortly.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Your message could not be sent.");
    }
  }

  return (
    <section className="contact-sales" id="contact-sales">
      <div className="contact-sales-copy">
        <span className="section-label">CONTACT SALES</span>
        <h3>Monitoring more than 2,500 URLs?</h3>
        <p>Tell us about your catalogue and check frequency. We’ll recommend an Enterprise setup for your team.</p>
      </div>
      <form onSubmit={submit}>
        <label><span>Name</span><input name="name" required maxLength={100} autoComplete="name"/></label>
        <label><span>Work email</span><input name="email" type="email" required maxLength={254} autoComplete="email"/></label>
        <label><span>Company</span><input name="company" required maxLength={120} autoComplete="organization"/></label>
        <label><span>Estimated URLs</span><input name="urlCount" type="number" required min={2500} max={1_000_000} step={1} placeholder="2500"/></label>
        <label className="contact-message"><span>What do you need?</span><textarea name="message" required minLength={10} maxLength={2000} placeholder="Monitoring frequency, markets, integrations, or onboarding needs"/></label>
        <label className="contact-honeypot" aria-hidden="true"><span>Website</span><input name="website" tabIndex={-1} autoComplete="off"/></label>
        <div className="contact-submit"><button disabled={state === "sending"} type="submit">{state === "sending" ? "Sending…" : "Contact us"}</button>{message && <p className={state === "sent" ? "contact-success" : "contact-error"} role="status">{message}</p>}</div>
      </form>
    </section>
  );
}
