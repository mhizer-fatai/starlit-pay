// Request metrics in Prometheus text format, kept in memory (they reset on
// restart, as Prometheus expects). Routes are labelled by pattern, and every
// unmatched URL shares one label, so random URLs can't grow the label set.

const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

export function createMetrics({ now = () => process.uptime() } = {}) {
  const requests = new Map(); // "method|route|status" -> count
  const durations = new Map(); // "method|route" -> { buckets, sum, count }

  return {
    recordRequest(method, route, status, durationMs) {
      const key = `${method}|${route}|${status}`;
      requests.set(key, (requests.get(key) ?? 0) + 1);
      const seconds = durationMs / 1000;
      const series = durations.get(`${method}|${route}`) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
      BUCKETS.forEach((le, i) => seconds <= le && series.buckets[i]++);
      series.sum += seconds;
      series.count++;
      durations.set(`${method}|${route}`, series);
    },

    render() {
      const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const lines = [
        "# HELP starlit_http_requests_total HTTP requests by route pattern and status.",
        "# TYPE starlit_http_requests_total counter",
      ];
      for (const [key, count] of requests) {
        const [method, route, status] = key.split("|");
        lines.push(`starlit_http_requests_total{method="${esc(method)}",route="${esc(route)}",status="${status}"} ${count}`);
      }
      lines.push("# HELP starlit_http_request_duration_seconds HTTP request duration.", "# TYPE starlit_http_request_duration_seconds histogram");
      for (const [key, { buckets, sum, count }] of durations) {
        const [method, route] = key.split("|");
        const labels = `method="${esc(method)}",route="${esc(route)}"`;
        BUCKETS.forEach((le, i) => lines.push(`starlit_http_request_duration_seconds_bucket{${labels},le="${le}"} ${buckets[i]}`));
        lines.push(`starlit_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${count}`);
        lines.push(`starlit_http_request_duration_seconds_sum{${labels}} ${sum.toFixed(6)}`);
        lines.push(`starlit_http_request_duration_seconds_count{${labels}} ${count}`);
      }
      const memory = process.memoryUsage();
      lines.push(
        "# HELP starlit_process_uptime_seconds Seconds since the process started.",
        "# TYPE starlit_process_uptime_seconds gauge",
        `starlit_process_uptime_seconds ${Math.round(now())}`,
        "# HELP starlit_process_resident_memory_bytes Resident memory.",
        "# TYPE starlit_process_resident_memory_bytes gauge",
        `starlit_process_resident_memory_bytes ${memory.rss}`,
        "# HELP starlit_nodejs_heap_used_bytes V8 heap in use.",
        "# TYPE starlit_nodejs_heap_used_bytes gauge",
        `starlit_nodejs_heap_used_bytes ${memory.heapUsed}`
      );
      return `${lines.join("\n")}\n`;
    },
  };
}

export const metrics = createMetrics();
