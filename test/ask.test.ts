import { describe, expect, it } from "bun:test";
import { AskQuestionManager } from "../core/tools/ask";

describe("Ask Questionnaire Tool Parity", () => {
  it("validates question schema correctly", () => {
    const mgr = new AskQuestionManager();

    expect(mgr.validateParams(null)).toBe(false);
    expect(mgr.validateParams({})).toBe(false);
    expect(mgr.validateParams({ questions: [] })).toBe(false);

    const valid = {
      questions: [
        {
          id: "auth_type",
          question: "Which authentication provider?",
          options: [{ label: "OAuth2" }, { label: "API Key" }],
          recommended: 0,
        },
      ],
    };
    expect(mgr.validateParams(valid)).toBe(true);
  });

  it("records single and multi answers and tracks completion", () => {
    const mgr = new AskQuestionManager();
    mgr.setQuestions([
      {
        id: "q1",
        question: "Single choice",
        options: [{ label: "A" }, { label: "B" }],
      },
      {
        id: "q2",
        question: "Multi choice",
        options: [{ label: "X" }, { label: "Y" }, { label: "Z" }],
        multi: true,
      },
    ]);

    expect(mgr.isComplete()).toBe(false);

    mgr.submitAnswer("q1", "A");
    expect(mgr.isComplete()).toBe(false);

    mgr.submitAnswer("q2", ["X", "Z"]);
    expect(mgr.isComplete()).toBe(true);

    const summary = mgr.formatAnswersSummary();
    expect(summary.q1).toEqual(["A"]);
    expect(summary.q2).toEqual(["X", "Z"]);
  });
});
