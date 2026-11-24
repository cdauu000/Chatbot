import { ExtractedEntities, IntentType, ActionType, WorkingMemory } from '../conversation-types.js';
import { ScoredRoomCandidate } from '../../search/search-types.js';
import { PreBookingQuoteResult } from '../../pricing/quote-types.js';
import { StayPackageEligibilityResult } from '../../pricing/stay-package-eligibility.js';

export interface ConversationHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ComposeAdvisoryParams {
  intent: IntentType;
  action: ActionType;
  userMessage: string;
  memory: WorkingMemory;
  candidates: Array<{
    item: ScoredRoomCandidate;
    quote?: PreBookingQuoteResult;
    bucket?: string;
  }>;
  comparisonNotes?: string[];
  policyAnswer?: string;
  missingInformation?: string[];
  referenceClock?: string;
  packageEligibility?: StayPackageEligibilityResult;
  roomDetail?: any;
  plan?: any;
  groundedData?: any;
}

export interface LLMAdapter {
  readonly name: string;

  /**
   * Parse natural language utterance into intent and structured entities.
   */
  parseIntentAndEntities(
    utterance: string,
    history: ConversationHistoryMessage[],
    memory: WorkingMemory | null,
    referenceClock?: string
  ): Promise<{ intent: IntentType; entities: ExtractedEntities; confidence: number }>;

  /**
   * Compose conversational advisory prose grounded strictly in verified data.
   */
  composeAdvisoryResponse(params: ComposeAdvisoryParams): Promise<string>;

  /**
   * Optional direct chat completion for Agent reasoning loops.
   */
  callChatCompletion?(
    messages: Array<{ role: string; content: string }>,
    options?: any
  ): Promise<{ raw_content: string; telemetry: any }>;
}
