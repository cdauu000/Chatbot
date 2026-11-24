import { JCollectionAgent, JCollectionAgentOptions } from './jcollection-agent.js';
import { NormalizedDataset } from '../domain/normalized-schema.js';

/**
 * JVillageAgent: Specialized Agent instance for J Village Hotel.
 * Inherits 100% shared reasoning loop and tools from JCollectionAgent.
 */
export class JVillageAgent extends JCollectionAgent {
  constructor(dataset: NormalizedDataset, options?: JCollectionAgentOptions) {
    super(dataset, 'j-village', options);
  }
}
