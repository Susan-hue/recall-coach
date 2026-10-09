// AI layer: question generation and answer grading.
// Uses Amazon Bedrock (Converse API) when AI_PROVIDER=bedrock,
// otherwise a deterministic local fallback so the project runs with no AWS keys.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const PROVIDER = (process.env.AI_PROVIDER || 'local').toLowerCase();
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-lite-v1:0';
let bedrock = null;

export function aiProvider() {
  return PROVIDER === 'bedrock' ? `bedrock:${MODEL_ID}` : 'local';
}

async function converse(system, user, maxTokens = 1200) {
  if (!bedrock) bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const res = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: { maxTokens, temperature: 0.2 },
    })
  );
  return res.output.message.content.map((c) => c.text || '').join('');
}

function extractJson(text) {
  const start = text.search(/[\[{]/);
  if (start === -1) throw new Error('No JSON in model output');
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  const end = text.lastIndexOf(close);
  return JSON.parse(text.slice(start, end + 1));
}

// ---------- Question generation ----------

export async function generateCards(notes, title) {
  if (PROVIDER === 'bedrock') {
    try {
      const out = await converse(
        'You turn study notes into active recall flashcards for spoken quizzing. ' +
          'Each question must be answerable in one or two spoken sentences and must come only from the notes. ' +
          'Respond with JSON only: [{"concept": "...", "question": "...", "answer": "..."}].',
        `Title: ${title}\n\nNotes:\n${notes}\n\nWrite between 5 and 15 cards covering every key concept.`
      );
      const cards = extractJson(out).filter((c) => c.question && c.answer);
      if (cards.length) return cards;
    } catch (err) {
      console.error('[ai] Bedrock generation failed, using local fallback:', err.message);
    }
  }
  return localGenerateCards(notes);
}

const DEF_PATTERN = /^(?:the\s+)?(.{2,70}?)\s+(is|are|refers to|means|describes|requires)\s+(.{8,})$/i;

export function localGenerateCards(notes) {
  const cards = [];
  const seen = new Set();
  const lines = notes
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((l) => l.replace(/^[\s\-*•\d.)]+/, '').trim())
    .filter(Boolean);

  for (const line of lines) {
    let concept, answer, verb;
    const glossary = line.match(/^([^:]{2,60}):\s+(.{8,})$/);
    if (glossary) {
      concept = glossary[1].trim();
      answer = glossary[2].trim();
      verb = 'is';
    } else {
      const m = line.match(DEF_PATTERN);
      if (!m) continue;
      [, concept, verb, answer] = m;
    }
    concept = concept.replace(/[.,;]$/, '').trim();
    answer = answer.replace(/\.$/, '').trim();
    const key = concept.toLowerCase();
    if (seen.has(key) || concept.split(' ').length > 8) continue;
    seen.add(key);
    const plural = /^are$/i.test(verb);
    // "A primary key" -> asked as "a primary key", labelled "Primary key".
    const article = concept.match(/^(a|an)\s+/i);
    const spoken = article ? concept.replace(/^(a|an)\s+/i, (m) => m.toLowerCase()) : concept;
    const label = article ? capitalize(concept.slice(article[0].length)) : concept;
    cards.push({ concept: label, question: buildQuestion(spoken, verb, plural), answer });
    if (cards.length >= 20) break;
  }
  return cards;
}

function buildQuestion(concept, verb, plural) {
  // Lowercase ordinary words ("Normalization") but keep acronyms ("SQL").
  if (/^[A-Z][a-z]/.test(concept)) concept = concept.charAt(0).toLowerCase() + concept.slice(1);
  const v = verb.toLowerCase();
  if (v === 'refers to') return `What does ${concept} refer to?`;
  if (v === 'means') return `What does ${concept} mean?`;
  if (v === 'describes') return `What does ${concept} describe?`;
  if (v === 'requires') return `What does ${concept} require?`;
  return `What ${plural ? 'are' : 'is'} ${concept}?`;
}

// ---------- Grading ----------

export async function gradeAnswer({ question, expected, answer }) {
  if (PROVIDER === 'bedrock') {
    try {
      const out = await converse(
        'You are a warm, encouraging study coach grading a spoken answer. ' +
          'Judge meaning, not wording: accept paraphrases and synonyms. ' +
          'Respond with JSON only: {"score": 0-100, "feedback": "one or two short spoken sentences", "missing": ["key idea not mentioned", ...]}.',
        `Question: ${question}\nReference answer: ${expected}\nStudent answer: ${answer}`,
        400
      );
      const r = extractJson(out);
      return {
        score: clamp(Math.round(Number(r.score) || 0)),
        feedback: String(r.feedback || ''),
        missing: Array.isArray(r.missing) ? r.missing.map(String) : [],
        grader: aiProvider(),
      };
    } catch (err) {
      console.error('[ai] Bedrock grading failed, using local fallback:', err.message);
    }
  }
  return localGrade({ expected, answer });
}

const STOP = new Set(
  'a an the and or of to in on for with by is are was were be been it its this that these those as at from which who what when where how into than then so such can may also each other their there they them used use using'.split(
    ' '
  )
);

function stem(w) {
  return w.replace(/(ing|ed|es|s)$/, '');
}

function keyTerms(text) {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w))
        .map(stem)
    ),
  ];
}

export function localGrade({ expected, answer }) {
  const want = keyTerms(expected);
  const have = new Set(keyTerms(answer || ''));
  const hit = want.filter((t) => have.has(t));
  const missing = want.filter((t) => !have.has(t));
  const score = want.length ? clamp(Math.round((hit.length / want.length) * 100 * 1.25)) : 0;
  let feedback;
  if (score >= 85) feedback = 'Excellent, you nailed the key ideas.';
  else if (score >= 60) feedback = `Good, you got the core of it. You could also mention ${missing.slice(0, 3).join(', ')}.`;
  else if (score >= 30) feedback = `Partly there. The full answer is: ${expected}.`;
  else feedback = `Not quite. The answer is: ${expected}.`;
  return { score, feedback, missing: missing.slice(0, 5), grader: 'local' };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clamp(n) {
  return Math.max(0, Math.min(100, n));
}
