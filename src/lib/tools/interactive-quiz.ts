import type { ToolDefinition } from "./types";

export interface InteractiveQuizInput {
  title: string;
  premise?: string;
  question: string;
  options: {
    id: string;
    text: string;
    isCorrect?: boolean;
    explanation?: string;
  }[];
  hint?: string;
}

export interface InteractiveQuizOutput {
  status: "rendered";
  totalOptions: number;
}

/**
 * Interactive puzzle/quiz widget tool.
 * Provides a strict, detailed schema with minimum 3 options so the LLM always
 * outputs full multiple-choice answers (A, B, C, D) with distinct text.
 */
export const interactiveQuizTool: ToolDefinition<InteractiveQuizInput, InteractiveQuizOutput> = {
  name: "interactive_quiz",
  description:
    "Render an interactive puzzle or quiz widget with clickable choices, hints, and feedback. You MUST provide at least 3-4 distinct answer options in the 'options' array so the user can choose.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Catchy title of the puzzle or scenario, e.g. 'Teka-teki 10 Kantong Koin Emas'",
        required: true,
      },
      premise: {
        type: "string",
        description: "Background story or full scenario description preceding the question.",
      },
      question: {
        type: "string",
        description: "The core deduction or multiple-choice question for the user.",
        required: true,
      },
      options: {
        type: "array",
        description:
          "MUST provide 3 to 4 distinct answer choices (A, B, C, D). Each choice must have id, text description, isCorrect boolean, and explanation.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Choice identifier letter, e.g. 'A', 'B', 'C', 'D'",
            },
            text: {
              type: "string",
              description: "Full descriptive text of this answer option",
            },
            isCorrect: {
              type: "boolean",
              description: "true if this is the correct solution, false otherwise",
            },
            explanation: {
              type: "string",
              description: "Explanation revealed when the user clicks this choice",
            },
          },
          required: ["id", "text", "isCorrect"],
        },
        required: true,
      },
      hint: {
        type: "string",
        description: "Helpful hint the user can uncover if stuck.",
      },
    },
    required: ["title", "question", "options"],
  },
  execute: async (params) => {
    return {
      success: true,
      data: {
        status: "rendered",
        totalOptions: params.options?.length ?? 0,
      },
    };
  },
};
