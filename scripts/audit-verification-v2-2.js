import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'artifacts', 'autonomous-evaluation-v2-2');

const scenarios = JSON.parse(fs.readFileSync(path.join(dir, 'customer-scenarios-500.json'), 'utf-8'));
const evalResults = JSON.parse(fs.readFileSync(path.join(dir, 'evaluation-results.json'), 'utf-8'));
const transcriptsRaw = fs.readFileSync(path.join(dir, 'conversation-transcripts.jsonl'), 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const tracesRaw = fs.readFileSync(path.join(dir, 'agent-decision-traces.jsonl'), 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'execution-manifest.json'), 'utf-8'));
const failureCsv = fs.readFileSync(path.join(dir, 'failure-distribution.csv'), 'utf-8');

console.log('=== AUDIT VERIFICATION OF AUTONOMOUS EVALUATION V2.2 ===\n');

// 1. Scenarios and Turns
const totalScenarios = scenarios.length;
const totalTurns = tracesRaw.length;
console.log(`1. Total Scenarios: ${totalScenarios}, Total Turns Executed: ${totalTurns}`);

// 2. Unique Opening Questions
const openingQuestions = new Set(scenarios.map(s => s.initialMessage));
console.log(`2. Unique Opening Questions: ${openingQuestions.size} / ${totalScenarios}`);

// 3. Unique Customer Message Strings
const allCustomerMsgs = new Set();
for (const s of scenarios) {
  for (const t of s.turnSpecs) {
    allCustomerMsgs.add(t.userMessage);
  }
}
console.log(`3. Total Unique Customer Messages: ${allCustomerMsgs.size}`);

// 4. Unique Bot Responses
const allBotResponses = new Set();
let undefinedCount = 0;
let mediaDeliveredTurns = 0;
for (const t of transcriptsRaw) {
  for (const turn of t.turns) {
    allBotResponses.add(turn.bot);
    if (turn.bot && turn.bot.includes('undefined')) undefinedCount++;
    if (turn.mediaCount > 0) mediaDeliveredTurns++;
  }
}
console.log(`4. Total Unique Bot Responses: ${allBotResponses.size}`);
console.log(`5. Delivered Media Turns: ${mediaDeliveredTurns} / ${totalTurns}`);
console.log(`6. 'undefined' Occurrences in Bot Responses: ${undefinedCount}`);

// 7. Discovery vs Held-out Collisions
const discoveryMsgs = new Set();
const heldOutMsgs = new Set();
for (const s of scenarios) {
  for (const t of s.turnSpecs) {
    if (s.split === 'discovery') discoveryMsgs.add(t.userMessage);
    else heldOutMsgs.add(t.userMessage);
  }
}
let collisions = 0;
for (const m of heldOutMsgs) {
  if (discoveryMsgs.has(m)) collisions++;
}
console.log(`7. Discovery vs Held-out Input String Collisions: ${collisions} (0 required)`);

// 8. Structured Decisions and Tool Results
let structuredDecisionsCount = 0;
let toolResultsCount = 0;
for (const r of evalResults) {
  for (const t of r.turns) {
    if (t.structuredDecisions && t.structuredDecisions.length > 0) structuredDecisionsCount++;
    if (t.toolResults && t.toolResults.length > 0) toolResultsCount++;
  }
}
console.log(`8. Non-empty structuredDecisions: ${structuredDecisionsCount} / ${totalTurns}`);
console.log(`9. Non-empty toolResults: ${toolResultsCount} / ${totalTurns}`);

// 10. Property Breakdown
const hdPass = evalResults.filter(r => r.propertyId === 'jacayl-ha-dong' && r.passed).length;
const hdTotal = evalResults.filter(r => r.propertyId === 'jacayl-ha-dong').length;
const tkcPass = evalResults.filter(r => r.propertyId === 'jacayl-tran-khat-chan' && r.passed).length;
const tkcTotal = evalResults.filter(r => r.propertyId === 'jacayl-tran-khat-chan').length;
const jvPass = evalResults.filter(r => r.propertyId === 'j-village' && r.passed).length;
const jvTotal = evalResults.filter(r => r.propertyId === 'j-village').length;

console.log(`10. Pass Rate by Property:`);
console.log(`    - Hà Đông: ${hdPass}/${hdTotal} (${((hdPass/hdTotal)*100).toFixed(1)}%)`);
console.log(`    - Trần Khát Chân: ${tkcPass}/${tkcTotal} (${((tkcPass/tkcTotal)*100).toFixed(1)}%)`);
console.log(`    - J Village: ${jvPass}/${jvTotal} (${((jvPass/jvTotal)*100).toFixed(1)}%)`);
console.log(`    - Overall: ${manifest.passedCount}/${manifest.scenarioCount} (${manifest.passRate})`);

// 11. Semantic Metrics (Mean, Min, Max, StdDev)
const metricKeys = [
  'goalCompletion',
  'intentUnderstanding',
  'contextUnderstanding',
  'factualAccuracy',
  'responseRelevance',
  'toolSelectionQuality',
  'proactiveness',
  'naturalness',
  'conciseness'
];

console.log(`\n11. Semantic Metrics Distribution (0 - 5.0 scale):`);
for (const k of metricKeys) {
  const vals = evalResults.map(r => r.evaluation[k]);
  const avg = (vals.reduce((a, b) => a + b, 0) / vals.length);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const variance = vals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / vals.length;
  const std = Math.sqrt(variance);
  console.log(`    - ${k.padEnd(22)}: Avg = ${avg.toFixed(2)}, Min = ${min.toFixed(1)}, Max = ${max.toFixed(1)}, StdDev = ${std.toFixed(2)}`);
}

// 12. Failure Distribution
console.log(`\n12. Failure Distribution Summary:`);
console.log(failureCsv.trim());
