import { loadRawDataset } from '../data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../domain/transformer.js';
import { InMemoryRoomSearchEngine } from '../search/in-memory-room-search.js';
import { RoomSearchCriteria } from '../search/search-types.js';

export interface BenchmarkMetrics {
  total_runs: number;
  min_ms: number;
  max_ms: number;
  mean_ms: number;
  p50_ms: number;
  p75_ms: number;
  p90_ms: number;
  p95_ms: number;
  p99_ms: number;
  throughput_qps: number;
}

export function runSearchBenchmark(iterations = 1000): BenchmarkMetrics {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const searchEngine = new InMemoryRoomSearchEngine(dataset);

  const testCases: RoomSearchCriteria[] = [
    {
      co_so_ma: 'jacayl-tran-khat-chan',
      stay_type: 'nghi_gio',
      duration_hours: 3,
      checkin_datetime: '2026-11-28T14:00:00+07:00',
      must_have_amenities: ['bon_tam'],
    },
    {
      co_so_ma: 'jacayl-ha-dong',
      stay_type: 'qua_dem',
      checkin_datetime: '2026-11-27T22:00:00+07:00',
      max_budget: 400000,
    },
    {
      co_so_ma: 'j-village',
      stay_type: 'nghi_gio',
      duration_hours: 2,
      must_have_amenities: ['bon_tam'],
      negated_constraints: ['ghế tình yêu'],
    },
    {
      hang: 'Suite',
      stay_type: 'nghi_gio',
      duration_hours: 4,
      checkin_datetime: '2026-11-25T10:00:00+07:00',
    },
    {
      must_have_amenities: ['ghe_tinh_yeu'],
      max_budget: 600000,
      stay_type: 'nghi_gio',
      duration_hours: 2,
    },
  ];

  // Warmup run
  for (let i = 0; i < 50; i++) {
    searchEngine.search(testCases[i % testCases.length]);
  }

  const latencies: number[] = new Array(iterations);

  for (let i = 0; i < iterations; i++) {
    const criteria = testCases[i % testCases.length];
    const t0 = performance.now();
    searchEngine.search(criteria);
    const t1 = performance.now();
    latencies[i] = t1 - t0;
  }

  latencies.sort((a, b) => a - b);

  const min = latencies[0];
  const max = latencies[latencies.length - 1];
  const sum = latencies.reduce((acc, v) => acc + v, 0);
  const mean = sum / iterations;

  const p = (pct: number) => latencies[Math.floor((pct / 100) * latencies.length)];

  return {
    total_runs: iterations,
    min_ms: Number(min.toFixed(4)),
    max_ms: Number(max.toFixed(4)),
    mean_ms: Number(mean.toFixed(4)),
    p50_ms: Number(p(50).toFixed(4)),
    p75_ms: Number(p(75).toFixed(4)),
    p90_ms: Number(p(90).toFixed(4)),
    p95_ms: Number(p(95).toFixed(4)),
    p99_ms: Number(p(99).toFixed(4)),
    throughput_qps: Math.round(iterations / (sum / 1000)),
  };
}

// Executed when run directly via CLI
if (process.argv[1] && process.argv[1].includes('search-benchmark')) {
  console.log('--- RUNNING J COLLECTION IN-MEMORY SEARCH BENCHMARK (1,000 queries) ---');
  const metrics = runSearchBenchmark(1000);
  console.log('Results:');
  console.log(`- Total Runs:      ${metrics.total_runs}`);
  console.log(`- Min Latency:     ${metrics.min_ms} ms`);
  console.log(`- Mean Latency:    ${metrics.mean_ms} ms`);
  console.log(`- p50 (Median):    ${metrics.p50_ms} ms`);
  console.log(`- p75 Latency:     ${metrics.p75_ms} ms`);
  console.log(`- p90 Latency:     ${metrics.p90_ms} ms`);
  console.log(`- p95 Latency:     ${metrics.p95_ms} ms`);
  console.log(`- p99 Latency:     ${metrics.p99_ms} ms`);
  console.log(`- Max Latency:     ${metrics.max_ms} ms`);
  console.log(`- Throughput:      ${metrics.throughput_qps} QPS`);
}
