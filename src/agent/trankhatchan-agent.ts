import { JCollectionAgent, JCollectionAgentOptions } from './jcollection-agent.js';
import { NormalizedDataset } from '../domain/normalized-schema.js';

/**
 * TranKhatChanAgent: Specialized Agent instance for Jacayl Hotel Trần Khát Chân.
 * Inherits 100% shared reasoning loop and tools from JCollectionAgent.
 */
export class TranKhatChanAgent extends JCollectionAgent {
  constructor(dataset: NormalizedDataset, options?: JCollectionAgentOptions) {
    super(dataset, 'jacayl-tran-khat-chan', options);
  }
}
