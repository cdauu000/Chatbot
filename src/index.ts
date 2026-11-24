import './config/env-loader.js';

/**
 * J Collection AI Concierge - Public API (Milestone 0 + Milestone 1 + Milestone 2 + Milestone 3)
 */

// Milestone 0: Data Foundation & Invariants
export * from './domain/types.js';
export * from './domain/evidence.js';
export * from './domain/raw-schema.js';
export * from './domain/normalized-schema.js';
export * from './domain/transformer.js';
export * from './domain/room-business-registry.js';
export * from './data-loader/raw-loader.js';
export * from './audit/dataset-auditor.js';

// Milestone 1: Pricing Engine, Quote Engine & Room Search
export * from './data-loader/pricing-policy-loader.js';
export * from './pricing/category-mapper.js';
export * from './pricing/pricing-types.js';
export * from './pricing/checkin-pricing-resolver.js';
export * from './pricing/quote-types.js';
export * from './pricing/prebooking-quote-engine.js';
export * from './pricing/stay-package-eligibility.js';
export * from './search/search-types.js';
export * from './search/in-memory-room-search.js';

// Milestone 2: Conversation Intelligence, Memory & Advisory
export * from './conversation/conversation-types.js';
export * from './conversation/memory-manager.js';
export * from './conversation/temporal-resolver.js';
export * from './conversation/reference-resolver.js';
export * from './conversation/nlu-engine.js';
export * from './conversation/advisory-composer.js';
export * from './conversation/adapters/llm-adapter.interface.js';
export * from './conversation/adapters/mock-llm-adapter.js';
export * from './conversation/orchestrator.js';
export * from './benchmark/search-benchmark.js';

// Milestone 3: Knowledge Base, Policy QA, Grounding, Claim Validator & Real LLM Gateway
export * from './knowledge/knowledge-types.js';
export * from './knowledge/knowledge-base.js';
export * from './knowledge/policy-qa-engine.js';
export * from './conversation/grounding/claim-validator.js';
export * from './conversation/grounding/grounded-answer-planner.js';
export * from './conversation/escalation/human-escalation-manager.js';
export * from './conversation/adapters/real-llm-gateway.js';

// Milestone 3.5: Free Multi-Provider LLM Integration (Groq + Gemini · Privacy Gate)
export * from './conversation/privacy/pii-redaction.js';
export * from './conversation/adapters/provider-types.js';
export * from './conversation/adapters/groq-provider.js';
export * from './conversation/adapters/gemini-provider.js';
export {
  FreeLLMGateway,
  FreeLLMGatewayConfig,
  ProviderHealthStatus,
} from './conversation/adapters/free-llm-gateway.js';

// Milestone 4: Staff Dashboard, Multi-Property Isolation & Human Takeover
export * from './staff/staff-types.js';
export * from './staff/persistence/sqlite-store.js';
export {
  AuthManager,
  StaffAuthError,
  ForbiddenError,
  AuthManagerOptions,
} from './staff/auth/access-control.js';
export * from './staff/takeover/takeover-coordinator.js';
export * from './staff/server/dashboard-server.js';
export * from './demo/dashboard-demo.js';

// Agentic Core: Unified JCollectionAgent, Property Subclasses & Architecture V2.1
export * from './agent/agent-contracts.js';
export * from './agent/agent-tools.js';
export * from './agent/generic-constraint-solver.js';
export * from './agent/jcollection-agent.js';
export * from './agent/hadong-agent.js';
export * from './agent/trankhatchan-agent.js';
export * from './agent/jvillage-agent.js';

