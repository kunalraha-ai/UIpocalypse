export { createGuard, hostMatches, isLocalHost, looksLikeProduction } from './target.js';
export type { TargetDecision, ModeDecision, SwarmMode, Guard, GuardOptions } from './target.js';
export {
  classifyAction,
  filterActions,
} from './actions.js';
export type { ActionLike, RiskClass, SkippedAction, FilterOptions } from './actions.js';
export { createRateLimiter, createRampMonitor } from './ramp.js';
export type { RampReport } from './ramp.js';
export { redactSecrets, redactEnv, redactForLlm } from './redact.js';
