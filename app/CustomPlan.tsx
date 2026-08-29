"use client";

import { useMemo, useState } from "react";

const frequencies = [
  { value: 1, label: "Once daily", multiplier: 1 },
  { value: 4, label: "4 checks per day", multiplier: 1.45 },
  { value: 12, label: "Every 2 hours", multiplier: 2.1 },
  { value: 24, label: "Every hour", multiplier: 3.2 },
];

export default function CustomPlan() {
  const [urls, setUrls] = useState(25);
  const [checks, setChecks] = useState(4);
  const price = useMemo(() => {
    const frequency = frequencies.find((item) => item.value === checks) ?? frequencies[1];
    const hostingAndOperationsBase = 20;
    const monitoringAndAiAllowance = urls * 0.12;
    const marginMultiplier = 1.35;
    return Math.max(100, Math.ceil((hostingAndOperationsBase + monitoringAndAiAllowance) * frequency.multiplier * marginMultiplier));
  }, [urls, checks]);
  const safeUrls = Math.min(5000, Math.max(25, urls || 25));

  return (
    <article className="custom-plan-card">
      <div className="custom-plan-copy"><span>Custom</span><h3>Build your own monitoring plan.</h3><p>Choose the exact number of public product URLs and how often they should be checked.</p><ul><li>✓ Any amount from 25 to 5,000 URLs</li><li>✓ Price and stock monitoring</li><li>✓ Email alerts and price history</li></ul></div>
      <div className="custom-plan-controls">
        <label><span>Monitored URLs</span><strong>{safeUrls.toLocaleString()}</strong><input type="range" min="25" max="5000" step="5" value={safeUrls} onChange={(event) => setUrls(Number(event.target.value))}/><input className="url-number" type="number" min="25" max="5000" step="1" value={urls} onChange={(event) => setUrls(Number(event.target.value))} aria-label="Exact number of monitored URLs"/></label>
        <label><span>Check frequency</span><select value={checks} onChange={(event) => setChecks(Number(event.target.value))}>{frequencies.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      </div>
      <div className="custom-plan-total"><span>Estimated monthly price</span><strong>€{price}<small>/month</small></strong><p>Start with a 14-day free trial. Includes hosting and a fair-use AI allowance.</p><a href={`/login?plan=custom&urls=${safeUrls}&checks=${checks}`}>Start free trial <b>→</b></a></div>
    </article>
  );
}
