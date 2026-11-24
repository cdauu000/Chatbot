import { LLMAdapter, ConversationHistoryMessage, ComposeAdvisoryParams } from './llm-adapter.interface.js';
import { NLUEngine } from '../nlu-engine.js';
import { AdvisoryComposer } from '../advisory-composer.js';
import { ExtractedEntities, IntentType, WorkingMemory } from '../conversation-types.js';

export class MockLLMAdapter implements LLMAdapter {
  public readonly name = 'MockDeterministicLLMAdapter';
  private nluEngine: NLUEngine;
  private composer: AdvisoryComposer;

  constructor(referenceClock?: string) {
    this.nluEngine = new NLUEngine(referenceClock);
    this.composer = new AdvisoryComposer();
  }

  public setReferenceClock(clock: string): void {
    this.nluEngine.setReferenceClock(clock);
  }

  public async parseIntentAndEntities(
    utterance: string,
    history: ConversationHistoryMessage[],
    memory: WorkingMemory | null,
    referenceClock?: string
  ): Promise<{ intent: IntentType; entities: ExtractedEntities; confidence: number }> {
    if (referenceClock) {
      this.nluEngine.setReferenceClock(referenceClock);
    }
    return this.nluEngine.parse(utterance, memory);
  }

  public async composeAdvisoryResponse(params: ComposeAdvisoryParams): Promise<string> {
    return this.composer.compose(params);
  }

  public async callChatCompletion(
    messages: Array<{ role: string; content: string }>,
    options?: any
  ): Promise<{ raw_content: string; telemetry: any }> {
    return {
      raw_content: JSON.stringify({
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Deterministic mock response',
        final_response: 'Dạ em chào anh/chị ạ! Em có thể hỗ trợ anh/chị như thế nào ạ?',
      }),
      telemetry: {
        provider: 'mock',
        model: 'internal-mock-engine',
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        latency_ms: 1,
        retries_attempted: 0,
        is_fallback: false,
      },
    };
  }
}
