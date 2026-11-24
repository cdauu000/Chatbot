/**
 * Runner script for Autonomous Customer Simulation Lab V2.2 (500 Scenarios)
 */
import '../../config/env-loader.js';
import { loadRawDataset } from '../../data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../../domain/transformer.js';
import { AutonomousCustomerSimulationLabV22 } from './autonomous-customer-simulation-lab-v2-2.js';

async function main() {
  process.env.CONVERSATION_ENGINE = 'agentic';

  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);

  const lab = new AutonomousCustomerSimulationLabV22({
    dataset,
  });

  const startTime = Date.now();
  const result = await lab.executeFullBenchmark({
    onProgress: (done, total) => {
      if (done % 50 === 0 || done === total) {
        console.log(`[Simulation V2.2 Progress] ${done} / ${total} scenarios executed.`);
      }
    },
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n======================================================================`);
  console.log(`  BENCHMARK V2.2 COMPLETE IN ${durationSec}s`);
  console.log(`======================================================================`);
  console.log('Manifest:', JSON.stringify(result.summary, null, 2));
}

main().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
