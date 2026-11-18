// Where the time goes in a private payment. Each phase runs from its mark to
// the next one; the SDK's progress events mark its own stages. Timings only:
// no amounts, recipients or keys are recorded.

export interface TimingPhase {
  name: string;
  seconds: number;
}

export interface TimingSummary {
  phases: TimingPhase[];
  total: number;
  /** Transactions the SDK needed (a payment from several notes can take more than one). */
  steps: number;
}

export interface PaymentTimer {
  mark(name: string): void;
  /** Marks a phase from an SDK progress event ("prove", step 1 of 2…). */
  stage(detail: { stage: string; current?: number; total?: number }): void;
  finish(): TimingSummary;
}

export function startTimer(now: () => number = () => performance.now()): PaymentTimer {
  const started = now();
  const marks: { name: string; at: number }[] = [];
  let steps = 1;

  const mark = (name: string) => {
    if (marks.at(-1)?.name !== name) marks.push({ name, at: now() });
  };

  return {
    mark,
    stage({ stage, current, total }) {
      if (total && total > steps) steps = total;
      mark(total && total > 1 ? `${stage} ${current}/${total}` : stage);
    },
    finish() {
      const end = now();
      const phases = marks.map((m, i) => ({
        name: m.name,
        seconds: round(((marks[i + 1]?.at ?? end) - m.at) / 1000),
      }));
      return { phases, total: round((end - started) / 1000), steps };
    },
  };
}

/** "open 4.1s · sync 12.3s · prove 7.8s · total 28.0s" */
export function formatTiming(summary: TimingSummary): string {
  const parts = summary.phases.map((p) => `${p.name} ${p.seconds.toFixed(1)}s`);
  parts.push(`total ${summary.total.toFixed(1)}s`);
  if (summary.steps > 1) parts.push(`${summary.steps} steps`);
  return parts.join(" · ");
}

const round = (n: number) => Math.round(n * 10) / 10;
