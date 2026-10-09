// Core study coach logic. Transport-agnostic: the MCP server and the
// simulated Alexa+ web client both call these functions.
import crypto from 'node:crypto';
import { getLearner, updateLearner } from './store.js';
import { generateCards, gradeAnswer as aiGrade } from './ai.js';
import { newCardState, schedule, describeDue } from './srs.js';

const id = (prefix) => `${prefix}_${crypto.randomBytes(4).toString('hex')}`;

export async function loadNotes(learnerId, { title, notes }) {
  if (!notes || notes.trim().length < 20) {
    throw new Error('Notes are too short. Paste at least a few sentences of study material.');
  }
  const generated = await generateCards(notes, title);
  if (!generated.length) {
    throw new Error('I could not find any quizzable concepts in those notes. Try notes with clear definitions.');
  }
  const deckId = id('deck');
  const now = Date.now();
  updateLearner(learnerId, (l) => {
    l.decks[deckId] = { id: deckId, title, createdAt: now, cardIds: [] };
    for (const c of generated) {
      const cardId = id('card');
      l.cards[cardId] = { id: cardId, deckId, concept: c.concept, question: c.question, answer: c.answer, ...newCardState(now) };
      l.decks[deckId].cardIds.push(cardId);
    }
  });
  return {
    deck_id: deckId,
    title,
    card_count: generated.length,
    concepts: generated.map((c) => c.concept),
    speech: `Got it. I made ${generated.length} questions from your ${title} notes. Say "quiz me" when you're ready.`,
  };
}

function resolveDeck(learner, deckRef) {
  if (!deckRef) return null;
  if (learner.decks[deckRef]) return learner.decks[deckRef];
  const needle = deckRef.toLowerCase();
  return Object.values(learner.decks).find((d) => d.title.toLowerCase().includes(needle)) || null;
}

function cardsFor(learner, deck) {
  const all = Object.values(learner.cards);
  return deck ? all.filter((c) => c.deckId === deck.id) : all;
}

export function nextQuestion(learnerId, { deck } = {}) {
  const learner = getLearner(learnerId);
  if (!Object.keys(learner.decks).length) {
    return { has_question: false, speech: "You don't have any study notes yet. Share some notes and I'll turn them into questions." };
  }
  const d = resolveDeck(learner, deck);
  if (deck && !d) {
    const titles = Object.values(learner.decks).map((x) => x.title).join(', ');
    return { has_question: false, speech: `I couldn't find a topic called ${deck}. Your topics are: ${titles}.` };
  }

  const now = Date.now();
  const pool = cardsFor(learner, d);
  const due = pool.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
  let card = due[0];
  let practiceAhead = false;

  if (!card) {
    // Nothing due: practise the weakest card anyway so the session never dead-ends.
    practiceAhead = true;
    card = [...pool].sort((a, b) => (a.lastScore ?? 0) - (b.lastScore ?? 0) || a.due - b.due)[0];
  }

  updateLearner(learnerId, (l) => {
    l.session = { currentCardId: card.id, askedAt: now };
  });

  const deckTitle = learner.decks[card.deckId].title;
  const lead = practiceAhead ? "You're all caught up, so here's a bonus round on your weakest topic. " : '';
  return {
    has_question: true,
    card_id: card.id,
    topic: deckTitle,
    concept: card.concept,
    question: card.question,
    due_remaining: Math.max(0, due.length - 1),
    practice_ahead: practiceAhead,
    speech: `${lead}${card.question}`,
  };
}

export async function submitAnswer(learnerId, { answer, card_id }) {
  const learner = getLearner(learnerId);
  const cardId = card_id || learner.session?.currentCardId;
  const card = cardId && learner.cards[cardId];
  if (!card) {
    return { graded: false, speech: 'There is no open question. Say "quiz me" to get one.' };
  }

  const result = await aiGrade({ question: card.question, expected: card.answer, answer });
  const now = Date.now();
  const updated = schedule(card, result.score, now);

  updateLearner(learnerId, (l) => {
    l.cards[card.id] = { ...l.cards[card.id], ...updated };
    l.history.push({ cardId: card.id, at: now, score: result.score, answer });
    if (l.history.length > 500) l.history.shift();
    l.session = null;
  });

  const when = describeDue(updated.due, now);
  return {
    graded: true,
    card_id: card.id,
    concept: card.concept,
    score: result.score,
    feedback: result.feedback,
    missing: result.missing,
    reference_answer: card.answer,
    next_review: when,
    grader: result.grader,
    speech: `${result.feedback} You scored ${result.score} out of 100. I'll bring this one back ${when}.`,
  };
}

export function getProgress(learnerId, { deck } = {}) {
  const learner = getLearner(learnerId);
  const d = resolveDeck(learner, deck);
  const now = Date.now();
  const decks = (d ? [d] : Object.values(learner.decks)).map((dk) => {
    const cards = cardsFor(learner, dk);
    const seen = cards.filter((c) => c.attempts > 0);
    const mastered = cards.filter((c) => c.reps >= 2 && (c.lastScore ?? 0) >= 75);
    const avg = seen.length ? Math.round(seen.reduce((s, c) => s + (c.lastScore ?? 0), 0) / seen.length) : null;
    const weakest = seen
      .filter((c) => (c.lastScore ?? 0) < 60)
      .sort((a, b) => a.lastScore - b.lastScore)
      .slice(0, 3)
      .map((c) => c.concept);
    return {
      deck_id: dk.id,
      title: dk.title,
      total: cards.length,
      new: cards.length - seen.length,
      mastered: mastered.length,
      due_now: cards.filter((c) => c.due <= now).length,
      average_score: avg,
      weakest_concepts: weakest,
    };
  });

  if (!decks.length) return { decks: [], speech: "You haven't added any study notes yet." };

  const speech = decks
    .map((x) => {
      let s = `${x.title}: ${x.mastered} of ${x.total} mastered, ${x.due_now} due now.`;
      if (x.average_score !== null) s += ` Average score ${x.average_score}.`;
      if (x.weakest_concepts.length) s += ` Focus on ${x.weakest_concepts.join(' and ')}.`;
      return s;
    })
    .join(' ');
  return { decks, speech };
}

export function listDecks(learnerId) {
  const learner = getLearner(learnerId);
  const decks = Object.values(learner.decks).map((d) => ({ deck_id: d.id, title: d.title, card_count: d.cardIds.length }));
  return {
    decks,
    speech: decks.length ? `You have ${decks.length} topic${decks.length > 1 ? 's' : ''}: ${decks.map((d) => d.title).join(', ')}.` : 'You have no topics yet.',
  };
}
