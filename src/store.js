// Simple JSON-file store. Same interface will be backed by DynamoDB later,
// so the rest of the code never touches storage details directly.
import fs from 'node:fs';
import path from 'node:path';

const DATA_FILE = process.env.DATA_FILE || path.resolve('data/store.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { learners: {} };
  }
}

let db = load();

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

export function getLearner(learnerId) {
  if (!db.learners[learnerId]) {
    db.learners[learnerId] = { decks: {}, cards: {}, history: [], session: null };
  }
  return db.learners[learnerId];
}

export function updateLearner(learnerId, fn) {
  const learner = getLearner(learnerId);
  const result = fn(learner);
  save();
  return result;
}

export function resetStore() {
  db = { learners: {} };
  save();
}
