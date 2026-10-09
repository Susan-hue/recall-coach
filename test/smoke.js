// End-to-end test: starts the server, connects as a real MCP client over
// Streamable HTTP, and walks through a full study session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

process.env.DATA_FILE = path.join(os.tmpdir(), `recall-coach-test-${Date.now()}.json`);

const { buildApp } = await import('../src/server.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

const server = buildApp().listen(0);
const port = server.address().port;
const client = new Client({ name: 'smoke-test', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)));

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  assert.ok(!res.isError, `${name} returned an error: ${res.content?.[0]?.text}`);
  return res.structuredContent;
};

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
console.log('Tools:', tools.join(', '));
assert.deepEqual(tools, ['check_answer', 'list_topics', 'load_study_notes', 'quiz_me', 'study_progress']);

const notes = fs.readFileSync(new URL('../data/sample-notes.md', import.meta.url), 'utf8');
const loaded = await call('load_study_notes', { title: 'Database normalization', notes });
console.log(`\nLoaded ${loaded.card_count} cards:`, loaded.concepts.join(' | '));
assert.ok(loaded.card_count >= 6);

// Answer one question well and one badly, and check scheduling reacts.
const q1 = await call('quiz_me');
console.log('\nQ1:', q1.speech);
const lookup = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8')).learners.demo.cards[q1.card_id].answer;
const good = await call('check_answer', { answer: lookup });
console.log('A1 (good):', good.speech);
assert.ok(good.score >= 75, 'good answer should score high');
assert.match(good.next_review, /day/);

const q2 = await call('quiz_me');
assert.notEqual(q2.card_id, q1.card_id, 'a reviewed card should not come straight back');
console.log('\nQ2:', q2.speech);
const bad = await call('check_answer', { answer: "I'm not sure, something about tables?" });
console.log('A2 (weak):', bad.speech);
assert.ok(bad.score < 40, 'weak answer should score low');
assert.match(bad.next_review, /minute/);

const noOpen = await call('check_answer', { answer: 'anything' });
assert.equal(noOpen.graded, false);

const progress = await call('study_progress', { topic: 'normalization' });
console.log('\nProgress:', progress.speech);
assert.equal(progress.decks[0].total, loaded.card_count);
assert.equal(progress.decks[0].new, loaded.card_count - 2);

const topics = await call('list_topics');
console.log('Topics:', topics.speech);

await client.close();
server.close();
fs.rmSync(process.env.DATA_FILE, { force: true });
console.log('\nAll checks passed.');
