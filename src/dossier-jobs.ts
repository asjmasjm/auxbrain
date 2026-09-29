import { DossierJob } from "./contracts";

export function dossierJobLabel(job: DossierJob): string {
  if (job.state === "completed" && job.receipt?.mode === "reused_build") return "已复用整理结果";
  return { queued: "知识整理已排队", running: "正在整理个人知识", completed: "知识整理完成", failed: "知识整理失败，回答仍可阅读" }[job.state];
}

export class DossierJobTracker {
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private read: (id: string) => Promise<DossierJob>,
    private update: (job: DossierJob, problem: string) => void,
    private interval = 2000, private limit = 60) {}
  stop(): void {
    this.epoch++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  start(initial: DossierJob): void {
    this.stop();
    const epoch = this.epoch;
    let attempts = 0;
    const receive = (job: DossierJob) => {
      if (epoch !== this.epoch) return;
      this.update(job, "");
      if (epoch !== this.epoch || !["queued", "running"].includes(job.state)) return;
      if (attempts >= this.limit) {
        this.update(job, "状态同步已暂停，请刷新状态");
        return;
      }
      this.timer = setTimeout(async () => {
        this.timer = null;
        try {
          attempts++;
          const next = await this.read(job.job_id);
          if (next.job_id !== job.job_id || !["queued", "running", "completed", "failed"].includes(next.state)) {
            throw new Error("Invalid dossier job response");
          }
          receive(next);
        } catch {
          if (epoch === this.epoch) this.update(job, "无法同步知识整理状态，请刷新状态");
        }
      }, this.interval);
    };
    receive(initial);
  }
}
