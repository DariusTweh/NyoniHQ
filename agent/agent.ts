import { defineAgent } from "eve";

export default defineAgent({
  model: "nvidia/nemotron-3.5-lightning-free",
  limits: {
    sessionUsage: ({ window }) =>
      window.outputTokens >= 5_000 || (window.costUsd ?? 0) >= 0.25,
    sessionTimeoutMs: 30 * 60 * 1_000,
  },
});
