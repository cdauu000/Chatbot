import fs from 'node:fs';

const scenarios = JSON.parse(fs.readFileSync('artifacts/autonomous-evaluation/customer-scenarios-500.json', 'utf-8'));
const evalResults = JSON.parse(fs.readFileSync('artifacts/autonomous-evaluation/evaluation-results.json', 'utf-8'));
const transcriptsRaw = fs.readFileSync('artifacts/autonomous-evaluation/conversation-transcripts.jsonl', 'utf-8');
const transcripts = transcriptsRaw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

console.log('=== AUDIT VERIFICATION ===');
console.log('Total scenarios in customer-scenarios-500.json:', scenarios.length);
console.log('Total eval records:', evalResults.length);
console.log('Total transcripts:', transcripts.length);

const openingQuestions = new Set(scenarios.map(s => s.initialMessage));
const allUserMessages = new Set();
const allBotResponses = new Set();
let totalTurns = 0;
let undefinedCount = 0;
let deliveredMediaCount = 0;

for (const t of transcripts) {
  for (const turn of t.turns) {
    totalTurns++;
    allUserMessages.add(turn.user);
    allBotResponses.add(turn.bot);
    if (turn.bot.includes('undefined')) undefinedCount++;
    if (turn.mediaCount > 0) deliveredMediaCount++;
  }
}

console.log('Total conversation turns:', totalTurns);
console.log('Unique opening questions:', openingQuestions.size);
console.log('Unique customer message strings across all turns:', allUserMessages.size);
console.log('Unique bot response strings:', allBotResponses.size);
console.log('Turns with undefined in bot response:', undefinedCount);
console.log('Turns with deliveredMedia > 0:', deliveredMediaCount);

const discoveryUserMsgs = new Set();
for (const s of scenarios.filter(s => s.split === 'discovery')) {
  for (const ts of s.turnSpecs) discoveryUserMsgs.add(ts.userMessage);
}
let heldOutDuplicates = 0;
const heldOutScenarios = scenarios.filter(s => s.split === 'held_out');
for (const s of heldOutScenarios) {
  const isDup = s.turnSpecs.every(ts => discoveryUserMsgs.has(ts.userMessage));
  if (isDup) heldOutDuplicates++;
}
console.log('Held-out scenarios duplicate with discovery:', heldOutDuplicates, '/', heldOutScenarios.length);

const passByProp = {};
for (const r of evalResults) {
  if (!passByProp[r.propertyId]) passByProp[r.propertyId] = { pass: 0, fail: 0, total: 0 };
  passByProp[r.propertyId].total++;
  if (r.passed) passByProp[r.propertyId].pass++;
  else passByProp[r.propertyId].fail++;
}
console.log('Pass/Fail by property:', JSON.stringify(passByProp, null, 2));

const providers = new Set();
const models = new Set();
let emptyDecisions = 0;
let emptyToolResults = 0;
for (const r of evalResults) {
  for (const t of r.turns) {
    providers.add(t.provider);
    models.add(t.model);
    if (!t.structuredDecisions || t.structuredDecisions.length === 0) emptyDecisions++;
    if (!t.toolResults || t.toolResults.length === 0) emptyToolResults++;
  }
}
console.log('Unique providers recorded:', Array.from(providers));
console.log('Unique models recorded:', Array.from(models));
console.log('Turns with empty structuredDecisions:', emptyDecisions, '/', totalTurns);
console.log('Turns with empty toolResults:', emptyToolResults, '/', totalTurns);

const criteria = ['intentUnderstanding', 'contextUnderstanding', 'responseRelevance', 'toolSelectionQuality', 'naturalness'];
for (const c of criteria) {
  const scores = evalResults.map(r => r.evaluation[c]);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  console.log('Criterion ' + c + ': min=' + min + ', max=' + max + ', avg=' + avg.toFixed(2));
}
