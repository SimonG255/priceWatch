"use client";

import { useMemo, useState } from "react";

const frequencies = [
  { value: 1, label: "Once daily", multiplier: 1 },
  { value: 4, label: "4 checks per day", multiplier: 1.45 },
  { value: 12, label: "Every 2 hours", multiplier: 2.1 },
  { value: 24, label: "Every hour", multiplier: 3.2 },
];

export default function CustomPlan() {
  const [urls, setUrls] = useState(250);
  const [checks, setChecks] = useState(4);
  const price = useMemo(() => {
    const frequency = frequencies.find((item) => item.value === checks) ?? frequencies[1];
    return Math.max(9, Math.ceil((8 + urls * 0.08) * frequency.multiplier));
  }, [urls, checks]);
  const safeUrls = Math.min(5000, Math.max(10, urls || 10));

  return (
    <article className="custom-plan-card">
      <div className="custom-plan-copy"><span>Custom</span><h3>Build your own monitoring plan.</h3><p>Choose the exact number of public product URLs and how often they should be checked.</p><ul><li>✓ Any amount from 10 to 5,000 URLs</li><li>✓ Price and stock monitoring</li><li>✓ Email alerts and price history</li></ul></div>
      <div className="custom-plan-controls">
        <label><span>Monitored URLs</span><strong>{safeUrls.toLocaleString()}</strong><input type="range" min="10" max="5000" step="10" value={safeUrls} onChange={(event) => setUrls(Number(event.target.value))}/><input className="url-number" type="number" min="10" max="5000" step="1" value={urls} onChange={(event) => setUrls(Number(event.target.value))} aria-label="Exact number of monitored URLs"/></label>
        <label><span>Check frequency</span><select value={checks} onChange={(event) => setChecks(Number(event.target.value))}>{frequencies.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      </div>
      <div className="custom-plan-total"><span>Estimated monthly price</span><strong>€{price}<small>/month</small></strong><p>Final pricing is confirmed before billing.</p><a href={`/login?plan=custom&urls=${safeUrls}&checks=${checks}`}>Choose {safeUrls.toLocaleString()} URLs <b>→</b></a></div>
    </article>
  );
}
