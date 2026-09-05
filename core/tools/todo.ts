/**
 * oh-my-pi Mobile: Todo State Machine
 *
 * Direct port of oh-my-pi's phased todo list tool.
 * Implements strict auto-promotion invariants:
 * - Earliest pending task auto-promotes to in_progress if none is in_progress.
 * - If multiple are in_progress, only the earliest stays in_progress.
 * - Blocked tasks never auto-promote.
 * - Completed tasks never revert.
 */

import type { TodoItem, TodoPhase } from "../types";

export type TodoOp =
  | "init"
  | "start"
  | "done"
  | "drop"
  | "block"
  | "unblock"
  | "append"
  | "rm"
  | "view";

export interface TodoToolParams {
  op: TodoOp;
  list?: Array<{ phase: string; items: string[] }>;
  items?: string[];
  task?: string;
  phase?: string;
  reason?: string;
}

export interface TodoResult {
  phases: TodoPhase[];
  activeTask?: TodoItem;
  summary: string;
}

export class TodoStateMachine {
  private phases: TodoPhase[] = [];

  constructor(initialPhases?: TodoPhase[]) {
    if (initialPhases) {
      this.phases = JSON.parse(JSON.stringify(initialPhases));
    }
  }

  getPhases(): TodoPhase[] {
    return JSON.parse(JSON.stringify(this.phases));
  }

  execute(params: TodoToolParams): TodoResult {
    switch (params.op) {
      case "init": {
        this.phases = [];
        if (params.list && params.list.length > 0) {
          for (const entry of params.list) {
            const items: TodoItem[] = entry.items.map((taskText, idx) => ({
              id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${idx}`,
              task: taskText,
              phase: entry.phase,
              status: "pending",
            }));
            this.phases.push({ phase: entry.phase, items });
          }
        } else if (params.items && params.items.length > 0) {
          const items: TodoItem[] = params.items.map((taskText, idx) => ({
            id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${idx}`,
            task: taskText,
            phase: "General",
            status: "pending",
          }));
          this.phases.push({ phase: "General", items });
        }
        break;
      }

      case "start": {
        if (params.task) {
          const item = this.findItem(params.task);
          if (item) {
            this.demoteOtherInProgress();
            item.status = "in_progress";
          }
        }
        break;
      }

      case "done": {
        if (params.task) {
          const item = this.findItem(params.task);
          if (item) item.status = "done";
        } else if (params.phase) {
          const p = this.phases.find((ph) => ph.phase === params.phase);
          if (p) {
            for (const it of p.items) {
              if (it.status !== "dropped") it.status = "done";
            }
          }
        }
        break;
      }

      case "drop": {
        if (params.task) {
          const item = this.findItem(params.task);
          if (item) item.status = "dropped";
        } else if (params.phase) {
          const p = this.phases.find((ph) => ph.phase === params.phase);
          if (p) {
            for (const it of p.items) it.status = "dropped";
          }
        }
        break;
      }

      case "block": {
        if (params.task) {
          const item = this.findItem(params.task);
          if (item) {
            item.status = "blocked";
            if (params.reason) item.reason = params.reason;
          }
        } else if (params.phase) {
          const p = this.phases.find((ph) => ph.phase === params.phase);
          if (p) {
            for (const it of p.items) {
              if (it.status !== "done" && it.status !== "dropped") {
                it.status = "blocked";
                if (params.reason) it.reason = params.reason;
              }
            }
          }
        }
        break;
      }

      case "unblock": {
        if (params.task) {
          const item = this.findItem(params.task);
          if (item && item.status === "blocked") {
            item.status = "pending";
            delete item.reason;
          }
        } else if (params.phase) {
          const p = this.phases.find((ph) => ph.phase === params.phase);
          if (p) {
            for (const it of p.items) {
              if (it.status === "blocked") {
                it.status = "pending";
                delete it.reason;
              }
            }
          }
        }
        break;
      }

      case "append": {
        const phaseName = params.phase ?? "General";
        let targetPhase = this.phases.find((ph) => ph.phase === phaseName);
        if (!targetPhase) {
          targetPhase = { phase: phaseName, items: [] };
          this.phases.push(targetPhase);
        }
        if (params.items) {
          for (let i = 0; i < params.items.length; i++) {
            targetPhase.items.push({
              id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}`,
              task: params.items[i],
              phase: phaseName,
              status: "pending",
            });
          }
        }
        break;
      }

      case "rm": {
        if (params.task) {
          for (const ph of this.phases) {
            ph.items = ph.items.filter((it) => it.task !== params.task);
          }
        } else if (params.phase) {
          this.phases = this.phases.filter((ph) => ph.phase !== params.phase);
        } else {
          this.phases = [];
        }
        break;
      }

      case "view":
      default:
        break;
    }

    // Apply auto-promotion invariant
    this.enforceAutoPromotion();

    return this.createResult();
  }

  private findItem(taskText: string): TodoItem | undefined {
    for (const ph of this.phases) {
      for (const it of ph.items) {
        if (it.task === taskText) return it;
      }
    }
    return undefined;
  }

  private demoteOtherInProgress(): void {
    for (const ph of this.phases) {
      for (const it of ph.items) {
        if (it.status === "in_progress") {
          it.status = "pending";
        }
      }
    }
  }

  private enforceAutoPromotion(): void {
    // 1. Gather all in_progress tasks
    const inProgressList: TodoItem[] = [];
    for (const ph of this.phases) {
      for (const it of ph.items) {
        if (it.status === "in_progress") inProgressList.push(it);
      }
    }

    // 2. If multiple are in_progress, keep only the earliest
    if (inProgressList.length > 1) {
      for (let i = 1; i < inProgressList.length; i++) {
        inProgressList[i].status = "pending";
      }
    }

    // 3. If none is in_progress, promote earliest pending
    if (inProgressList.length === 0) {
      for (const ph of this.phases) {
        const earliestPending = ph.items.find((it) => it.status === "pending");
        if (earliestPending) {
          earliestPending.status = "in_progress";
          break;
        }
      }
    }
  }

  private createResult(): TodoResult {
    let total = 0;
    let completed = 0;
    let inProgress: TodoItem | undefined;

    for (const ph of this.phases) {
      for (const it of ph.items) {
        total++;
        if (it.status === "done") completed++;
        if (it.status === "in_progress" && !inProgress) inProgress = it;
      }
    }

    const summary = `${completed}/${total} completed. Active: ${inProgress ? inProgress.task : "none"}`;
    return {
      phases: this.getPhases(),
      activeTask: inProgress,
      summary,
    };
  }
}
