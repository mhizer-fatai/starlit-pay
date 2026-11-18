import { describe, expect, test } from "vitest";
import { formatTiming, startTimer } from "@/lib/paymentTiming";

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (seconds: number) => (t += seconds * 1000) };
};

describe("payment timing", () => {
  test("each phase runs from its mark to the next", () => {
    const c = clock();
    const timer = startTimer(c.now);
    timer.mark("open");
    c.advance(4);
    timer.mark("sync");
    c.advance(12.3);
    timer.stage({ stage: "prove" });
    c.advance(7.8);
    timer.stage({ stage: "submit" });
    c.advance(3);

    const summary = timer.finish();
    expect(summary.phases).toEqual([
      { name: "open", seconds: 4 },
      { name: "sync", seconds: 12.3 },
      { name: "prove", seconds: 7.8 },
      { name: "submit", seconds: 3 },
    ]);
    expect(summary.total).toBe(27.1);
    expect(formatTiming(summary)).toBe("open 4.0s · sync 12.3s · prove 7.8s · submit 3.0s · total 27.1s");
  });

  test("repeated events for one stage count once, and multi-step payments are labelled", () => {
    const c = clock();
    const timer = startTimer(c.now);
    timer.stage({ stage: "prove", current: 1, total: 2 });
    c.advance(5);
    timer.stage({ stage: "prove", current: 1, total: 2 });
    c.advance(1);
    timer.stage({ stage: "prove", current: 2, total: 2 });
    c.advance(6);

    const summary = timer.finish();
    expect(summary.phases.map((p) => p.name)).toEqual(["prove 1/2", "prove 2/2"]);
    expect(summary.steps).toBe(2);
    expect(formatTiming(summary)).toContain("2 steps");
  });
});
