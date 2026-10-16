/** Bounded, process-local Prometheus counters and cumulative histograms. No payloads. */
export class Metrics {
  private readonly values = new Map<string, number>();
  add(name: string, labels: Record<string, string> = {}, value = 1) {
    this.put(name, labels, value, true);
  }
  gauge(name: string, labels: Record<string, string>, value: number) {
    this.put(name, labels, value, false);
  }
  private put(name: string, labels: Record<string, string>, value: number, increment: boolean) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || !Number.isFinite(value))
      throw new Error("Invalid metric");
    const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, label] of entries)
      if (!/^[a-z_]+$/.test(key) || !/^[a-zA-Z0-9_/:.*{}+ -]{1,160}$/.test(label))
        throw new Error("Invalid metric label");
    const key =
      name + (entries.length ? `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}` : "");
    if (!this.values.has(key) && this.values.size >= 10000) return;
    this.values.set(key, (increment ? (this.values.get(key) ?? 0) : 0) + value);
  }
  duration(name: string, labels: Record<string, string>, seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid duration");
    for (const limit of [0.01, 0.05, 0.1, 0.3, 1, 5, 30, Infinity])
      this.add(
        `${name}_bucket`,
        { ...labels, le: limit === Infinity ? "+Inf" : String(limit) },
        seconds <= limit ? 1 : 0,
      );
    this.add(`${name}_sum`, labels, seconds);
    this.add(`${name}_count`, labels);
  }
  render() {
    return [...this.values]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key} ${value}\n`)
      .join("");
  }
}
