import { getState, setState } from "../store/db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Tier = "fast" | "standard" | "premium";

export interface OverrideRule {
  name: string;
  keywords: string[];
  model: string;
}

export interface RouterConfig {
  enabled: boolean;
  tierModels: Record<Tier, string>;
  overrides: OverrideRule[];
  cooldownMessages: number;
}

export interface RouteResult {
  model: string;
  tier: Tier | null;
  overrideName?: string;
  switched: boolean;
  routerMode: "auto" | "manual";
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RouterConfig = {
  enabled: true,
  tierModels: {
    fast: "gpt-4.1",
    standard: "claude-sonnet-4.6",
    premium: "claude-opus-4.6",
  },
  overrides: [
    {
      name: "design",
      keywords: [
        "design", "ui", "ux", "css", "layout", "styling", "visual",
        "mockup", "wireframe", "frontend design", "tailwind", "responsive",
      ],
      model: "claude-opus-4.6",
    },
  ],
  cooldownMessages: 2,
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let lastTier: Tier | null = null;
let messagesSinceSwitch = 0;

// ---------------------------------------------------------------------------
// Keyword lists for tier classification
// ---------------------------------------------------------------------------

const GREETING_PATTERNS = [
  "hello", "hi", "hey", "good morning", "good afternoon", "good evening",
  "what's up", "whats up", "sup", "howdy", "yo",
];

const THANKS_PATTERNS = [
  "thanks", "thank you", "thx", "ty",
];

const ACK_PATTERNS = [
  "ok", "okay", "got it", "sure", "cool", "nice", "great", "sounds good",
  "right", "alright", "yep", "yup", "nope", "nah",
];

const FOLLOW_UP_PATTERNS = [
  "yes", "no", "do it", "go ahead", "sure", "sounds good", "looks good",
  "perfect", "+1", "please", "yep", "yup", "nope", "nah", "ok", "okay",
  "got it", "cool", "nice", "great", "alright", "right",
];

const STANDARD_TOOL_KEYWORDS = [
  "remember", "recall", "forget", "memory", "worker", "session", "skill",
  "model", "status", "check", "list", "create", "kill", "send",
];

const STANDARD_CODE_KEYWORDS = [
  "code", "file", "directory", "function", "variable", "class", "module",
  "import", "export", "compile", "build", "test", "deploy", "git",
  "commit", "branch", "merge", "pull", "push", "npm", "node", "python",
  "javascript", "typescript", "react", "api", "endpoint", "server",
  "database", "query", "bug", "error", "fix", "implement", "feature",
];

const STANDARD_COMMAND_PATTERNS = [
  "go ahead", "do it", "start", "run", "execute", "proceed",
];

const PREMIUM_KEYWORDS = [
  "architect", "analyze", "compare", "evaluate", "trade-off", "tradeoff",
  "pros and cons", "deep dive", "explain in detail", "complex", "strategy",
  "optimize", "refactor entire", "review", "plan",
];

const PREMIUM_DEBUG_KEYWORDS = [
  "debug", "investigate", "root cause", "why is",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip channel prefixes and trim whitespace. */
function sanitize(prompt: string): string {
  return prompt
    .replace(/^\[via telegram\]\s*/i, "")
    .replace(/^\[via tui\]\s*/i, "")
    .trim();
}

/** Word-boundary match that avoids partial-word hits (e.g. "ui" ≠ "fruit"). */
function wordMatch(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

/** Check if any keyword in the list matches (word-boundary, case-insensitive). */
function anyWordMatch(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => wordMatch(text, kw));
}

/** Count question marks in a string. */
function countQuestionMarks(text: string): number {
  return (text.match(/\?/g) || []).length;
}

/** Check for numbered items like "1.", "2.", etc. */
function hasNumberedItems(text: string): boolean {
  const matches = text.match(/^\s*\d+[.)]\s/gm);
  return !!matches && matches.length >= 2;
}

// ---------------------------------------------------------------------------
// Config management
// ---------------------------------------------------------------------------

export function getRouterConfig(): RouterConfig {
  let config: RouterConfig;

  const stored = getState("router_config");
  if (stored) {
    try {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    } catch {
      config = { ...DEFAULT_CONFIG };
    }
  } else {
    config = { ...DEFAULT_CONFIG };
  }

  // Environment variable overrides
  const envEnabled = process.env.ROUTER_ENABLED;
  if (envEnabled !== undefined) {
    config.enabled = envEnabled.toLowerCase() === "true";
  }

  const tierEnvMap: Record<Tier, string> = {
    fast: "ROUTER_FAST_MODEL",
    standard: "ROUTER_STANDARD_MODEL",
    premium: "ROUTER_PREMIUM_MODEL",
  };
  for (const [tier, envKey] of Object.entries(tierEnvMap)) {
    const val = process.env[envKey];
    if (val) {
      config.tierModels[tier as Tier] = val;
    }
  }

  return config;
}

export function updateRouterConfig(partial: Partial<RouterConfig>): RouterConfig {
  const current = getRouterConfig();
  const merged: RouterConfig = {
    ...current,
    ...partial,
    tierModels: {
      ...current.tierModels,
      ...(partial.tierModels ?? {}),
    },
    overrides: partial.overrides ?? current.overrides,
  };
  setState("router_config", JSON.stringify(merged));
  return merged;
}

// ---------------------------------------------------------------------------
// Tier classification
// ---------------------------------------------------------------------------

export function classifyMessage(
  prompt: string,
  recentTiers?: Tier[],
): { tier: Tier; confidence: number } {
  const text = sanitize(prompt);
  const lower = text.toLowerCase();
  const len = text.length;

  // Background tasks → always standard
  if (lower.startsWith("[background task completed]")) {
    return { tier: "standard", confidence: 1.0 };
  }

  // Follow-up detection: very short replies inherit last tier
  if (len < 20 && recentTiers && recentTiers.length > 0) {
    const isFollowUp = FOLLOW_UP_PATTERNS.some((p) => lower === p || lower === p + ".");
    if (isFollowUp) {
      return { tier: recentTiers[0], confidence: 0.85 };
    }
  }

  // Score each tier
  let fastScore = 0;
  let standardScore = 0;
  let premiumScore = 0;

  // --- FAST signals ---
  if (len < 40) {
    if (anyWordMatch(lower, GREETING_PATTERNS)) fastScore += 0.9;
    if (anyWordMatch(lower, THANKS_PATTERNS)) fastScore += 0.9;
    if (anyWordMatch(lower, ACK_PATTERNS)) fastScore += 0.8;
    // Short message with no code/tech terms gets a base fast bump
    if (!anyWordMatch(lower, STANDARD_CODE_KEYWORDS) && !anyWordMatch(lower, STANDARD_TOOL_KEYWORDS)) {
      fastScore += 0.2;
    }
  }

  // --- STANDARD signals ---
  if (anyWordMatch(lower, STANDARD_CODE_KEYWORDS)) standardScore += 0.6;
  if (anyWordMatch(lower, STANDARD_TOOL_KEYWORDS)) standardScore += 0.5;
  if (anyWordMatch(lower, STANDARD_COMMAND_PATTERNS)) standardScore += 0.3;
  if (len >= 60 && len <= 400) standardScore += 0.3;
  // Standard is the default — give it a small baseline
  standardScore += 0.1;

  // --- PREMIUM signals ---
  if (anyWordMatch(lower, PREMIUM_KEYWORDS)) premiumScore += 0.7;
  if (len > 400) premiumScore += 0.5;
  // Multi-part questions
  const qCount = countQuestionMarks(text);
  if (qCount >= 2) premiumScore += 0.3;
  if (hasNumberedItems(text)) premiumScore += 0.3;
  // Debug + long context
  if (anyWordMatch(lower, PREMIUM_DEBUG_KEYWORDS) && len > 150) premiumScore += 0.5;

  // Pick the winning tier
  const scores: { tier: Tier; score: number }[] = [
    { tier: "fast", score: fastScore },
    { tier: "standard", score: standardScore },
    { tier: "premium", score: premiumScore },
  ];

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const runnerUp = scores[1];

  // Confidence is the gap between best and runner-up, clamped to [0, 1]
  const confidence = Math.min(1.0, Math.max(0, best.score - runnerUp.score + 0.5));

  return { tier: best.tier, confidence: Math.round(confidence * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Override evaluation
// ---------------------------------------------------------------------------

function evaluateOverrides(
  text: string,
  overrides: OverrideRule[],
): OverrideRule | null {
  const lower = text.toLowerCase();
  for (const rule of overrides) {
    if (anyWordMatch(lower, rule.keywords)) {
      return rule;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function resolveModel(
  prompt: string,
  currentModel: string,
  recentTiers?: Tier[],
): RouteResult {
  const config = getRouterConfig();

  // Router disabled → manual mode
  if (!config.enabled) {
    messagesSinceSwitch = 0;
    return {
      model: currentModel,
      tier: null,
      switched: false,
      routerMode: "manual",
    };
  }

  const text = sanitize(prompt);

  // 1. Check overrides first — they bypass cooldown
  const override = evaluateOverrides(text, config.overrides);
  if (override) {
    const switched = override.model !== currentModel;
    if (switched) messagesSinceSwitch = 0;
    lastTier = null;
    return {
      model: override.model,
      tier: null,
      overrideName: override.name,
      switched,
      routerMode: "auto",
    };
  }

  // 2. Classify the message
  const { tier } = classifyMessage(prompt, recentTiers);
  const targetModel = config.tierModels[tier];
  const wouldSwitch = targetModel !== currentModel;

  // 3. Cooldown logic — prevent rapid switching
  if (wouldSwitch && messagesSinceSwitch < config.cooldownMessages) {
    messagesSinceSwitch++;
    lastTier = tier;
    return {
      model: currentModel,
      tier,
      switched: false,
      routerMode: "auto",
    };
  }

  // 4. Apply the switch (or keep current)
  if (wouldSwitch) {
    messagesSinceSwitch = 0;
  } else {
    messagesSinceSwitch++;
  }
  lastTier = tier;

  return {
    model: targetModel,
    tier,
    switched: wouldSwitch,
    routerMode: "auto",
  };
}
