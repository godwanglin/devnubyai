/**
 * Choices offered during onboarding. Shared by the UI (labels come from i18n
 * `onboarding.roles.<id>` / `onboarding.interests.<id>`) and the API (validation)
 * and by home suggestions (the English `hint` is what the AI reads).
 */
export const ONBOARDING_ROLES = [
  { id: "developer", hint: "software developer / programmer" },
  { id: "student", hint: "student (school or university)" },
  { id: "teacher", hint: "teacher or lecturer" },
  { id: "designer", hint: "designer (UI/UX, graphic)" },
  { id: "writer", hint: "writer or content creator" },
  { id: "business", hint: "business owner, marketing or sales" },
  { id: "researcher", hint: "researcher or data analyst" },
  { id: "explorer", hint: "just exploring what AI can do" },
] as const;

/** Every interest any role can pick; which ones a role sees is in ROLE_INTERESTS. */
export const ONBOARDING_INTERESTS = [
  // Building software
  { id: "coding", hint: "writing code" },
  { id: "debugging", hint: "fixing bugs and errors" },
  { id: "code_review", hint: "reviewing and refactoring code" },
  { id: "learn_framework", hint: "learning a new language or framework" },
  { id: "architecture", hint: "system design and architecture" },
  { id: "database", hint: "databases and SQL" },
  { id: "devops", hint: "deployment, servers and DevOps" },
  { id: "testing", hint: "writing tests" },
  { id: "tech_docs", hint: "technical documentation" },
  // Studying
  { id: "learning", hint: "learning new concepts" },
  { id: "homework", hint: "working through assignments" },
  { id: "summarize", hint: "summarizing material" },
  { id: "exam_prep", hint: "preparing for exams" },
  { id: "essay", hint: "writing essays" },
  { id: "math", hint: "math and science problems" },
  { id: "thesis", hint: "thesis and final projects" },
  // Teaching
  { id: "lesson_material", hint: "making teaching material" },
  { id: "quiz", hint: "making questions and quizzes" },
  { id: "lesson_plan", hint: "planning lessons" },
  { id: "grading", hint: "grading and giving feedback" },
  { id: "explain_simply", hint: "explaining things simply" },
  // Design
  { id: "design_ideas", hint: "design ideas and moodboards" },
  { id: "ui_ux", hint: "UI/UX design" },
  { id: "images", hint: "generating images" },
  { id: "branding", hint: "branding and logos" },
  { id: "design_copy", hint: "copy for designs" },
  { id: "design_feedback", hint: "feedback on designs" },
  // Writing and content
  { id: "writing", hint: "writing and editing text" },
  { id: "brainstorming", hint: "brainstorming ideas" },
  { id: "social_content", hint: "social media content" },
  { id: "storytelling", hint: "stories and creative writing" },
  { id: "video_script", hint: "video and podcast scripts" },
  { id: "seo", hint: "SEO and articles" },
  { id: "translation", hint: "translating" },
  // Business
  { id: "strategy", hint: "business strategy and planning" },
  { id: "email_proposal", hint: "emails and proposals" },
  { id: "marketing", hint: "marketing campaigns" },
  { id: "sales", hint: "sales and customer communication" },
  { id: "finance", hint: "finance and budgeting" },
  { id: "meeting_notes", hint: "meeting notes and summaries" },
  { id: "documents", hint: "making documents, spreadsheets and slides" },
  // Research
  { id: "research", hint: "researching topics" },
  { id: "data", hint: "analyzing data" },
  { id: "statistics", hint: "statistics" },
  { id: "paper_summary", hint: "summarizing papers" },
  { id: "literature_review", hint: "literature reviews" },
  { id: "report", hint: "writing reports" },
  // Everyday
  { id: "productivity", hint: "planning and productivity" },
  { id: "career", hint: "career, CV and interviews" },
  { id: "daily_life", hint: "everyday questions and tips" },
] as const;

export type OnboardingRole = (typeof ONBOARDING_ROLES)[number]["id"];
export type OnboardingInterest = (typeof ONBOARDING_INTERESTS)[number]["id"];

/** Interests shown for each role, most relevant first. */
export const ROLE_INTERESTS: Record<OnboardingRole, OnboardingInterest[]> = {
  developer: [
    "coding", "debugging", "code_review", "learn_framework", "architecture", "database",
    "devops", "testing", "tech_docs", "ui_ux", "data", "productivity", "career", "translation",
  ],
  student: [
    "learning", "homework", "summarize", "exam_prep", "essay", "math", "thesis",
    "documents", "research", "coding", "translation", "career", "productivity", "brainstorming",
  ],
  teacher: [
    "lesson_material", "quiz", "lesson_plan", "grading", "explain_simply", "documents",
    "summarize", "research", "images", "writing", "translation", "productivity", "email_proposal",
  ],
  designer: [
    "design_ideas", "ui_ux", "images", "branding", "design_copy", "design_feedback",
    "social_content", "brainstorming", "documents", "coding", "career", "productivity",
  ],
  writer: [
    "writing", "brainstorming", "social_content", "storytelling", "video_script", "seo",
    "translation", "images", "research", "summarize", "marketing", "productivity",
  ],
  business: [
    "strategy", "email_proposal", "marketing", "sales", "finance", "meeting_notes",
    "documents", "data", "social_content", "brainstorming", "translation", "productivity", "career",
  ],
  researcher: [
    "research", "data", "statistics", "paper_summary", "literature_review", "report",
    "summarize", "coding", "documents", "writing", "translation", "productivity",
  ],
  explorer: [
    "learning", "brainstorming", "writing", "coding", "images", "summarize", "translation",
    "research", "documents", "productivity", "career", "daily_life", "social_content", "math",
  ],
};

export const MAX_INTERESTS = 5;

export const ROLE_IDS = ONBOARDING_ROLES.map((r) => r.id) as [OnboardingRole, ...OnboardingRole[]];
export const INTEREST_IDS = ONBOARDING_INTERESTS.map((i) => i.id) as [OnboardingInterest, ...OnboardingInterest[]];

/** Onboarding steps, in order; the URL is `#/onboarding/<step>`. */
export const ONBOARDING_STEPS = ["name", "role", "interests", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
