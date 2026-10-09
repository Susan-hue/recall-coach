// Spaced repetition based on SM-2.
// A card answered well comes back later and later; a card answered poorly
// comes back soon. Score is 0-100 from the grader.

const DAY_MS = 24 * 60 * 60 * 1000;

export function newCardState(now = Date.now()) {
  return { ease: 2.5, intervalDays: 0, reps: 0, due: now, lastScore: null, attempts: 0 };
}

export function scoreToQuality(score) {
  if (score >= 90) return 5;
  if (score >= 75) return 4;
  if (score >= 60) return 3;
  if (score >= 40) return 2;
  if (score >= 20) return 1;
  return 0;
}

export function schedule(state, score, now = Date.now()) {
  const q = scoreToQuality(score);
  const next = { ...state, attempts: state.attempts + 1, lastScore: score };

  if (q < 3) {
    // Missed it: start over and bring it back in about 10 minutes.
    next.reps = 0;
    next.intervalDays = 0;
    next.due = now + 10 * 60 * 1000;
  } else {
    next.reps = state.reps + 1;
    if (next.reps === 1) next.intervalDays = 1;
    else if (next.reps === 2) next.intervalDays = 3;
    else next.intervalDays = Math.round(state.intervalDays * state.ease);
    next.due = now + next.intervalDays * DAY_MS;
  }

  next.ease = Math.max(1.3, state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  return next;
}

export function describeDue(due, now = Date.now()) {
  const diff = due - now;
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
