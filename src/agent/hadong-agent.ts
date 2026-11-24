import { NormalizedDataset } from '../domain/normalized-schema.js';
import {
  JCollectionAgent,
  JCollectionAgentOptions,
  AgentDecisionOutputSchema,
} from './jcollection-agent.js';

export { AgentDecisionOutputSchema };

export interface HadongAgentOptions extends JCollectionAgentOptions {}

/**
 * HadongAgent: Specialized Agent for Jacayl Hotel Hà Đông.
 * Extends the unified multi-property JCollectionAgent (V2.0 Model-Driven Core Consolidation).
 */
export class HadongAgent extends JCollectionAgent {
  constructor(dataset: NormalizedDataset, options?: HadongAgentOptions) {
    super(dataset, 'jacayl-ha-dong', options);
  }
}
