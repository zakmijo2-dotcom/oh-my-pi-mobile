/**
 * oh-my-pi Mobile: Ask Questionnaire Tool
 *
 * Direct port of oh-my-pi's structured interactive question tool.
 * Enables the agent to ask clarification questions with multi-option selections,
 * recommended defaults, and custom user responses.
 */

export interface AskOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface AskQuestion {
  id: string;
  question: string;
  options: AskOption[];
  header?: string;
  multi?: boolean;
  recommended?: number;
}

export interface AskToolParams {
  questions: AskQuestion[];
}

export interface AskAnswer {
  questionId: string;
  selected: string[];
}

export class AskQuestionManager {
  private activeQuestions: Map<string, AskQuestion> = new Map();
  private answers: Map<string, string[]> = new Map();

  validateParams(params: unknown): params is AskToolParams {
    if (!params || typeof params !== "object" || !("questions" in params)) {
      return false;
    }
    const qList = params.questions;
    if (!Array.isArray(qList) || qList.length === 0) {
      return false;
    }
    for (const q of qList) {
      if (!q || typeof q !== "object" || !("id" in q) || !("question" in q) || !("options" in q)) {
        return false;
      }
      if (!Array.isArray(q.options) || q.options.length === 0) {
        return false;
      }
    }
    return true;
  }

  setQuestions(questions: AskQuestion[]): void {
    this.activeQuestions.clear();
    this.answers.clear();
    for (const q of questions) {
      this.activeQuestions.set(q.id, q);
    }
  }

  getQuestions(): AskQuestion[] {
    return Array.from(this.activeQuestions.values());
  }

  submitAnswer(questionId: string, selection: string | string[]): boolean {
    const q = this.activeQuestions.get(questionId);
    if (!q) return false;

    const arr = Array.isArray(selection) ? selection : [selection];
    this.answers.set(questionId, arr);
    return true;
  }

  isComplete(): boolean {
    for (const qId of this.activeQuestions.keys()) {
      if (!this.answers.has(qId)) return false;
    }
    return true;
  }

  formatAnswersSummary(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [k, v] of this.answers.entries()) {
      out[k] = [...v];
    }
    return out;
  }
}
