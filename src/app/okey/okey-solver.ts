import {
  ALL_OKEY_CARDS,
  OKEY_COMBO_SIZE,
  OKEY_HAND_SIZE,
  OkeyCard,
  OkeyCombo,
  OkeySessionState,
  okeyCardId,
  okeyCardLabel,
} from './okey-types';

export type OkeyPlayOption = {
  combo: OkeyCombo;
  futureEv: number;
  totalEv: number;
  residual: OkeyCard[];
};

export type OkeyDiscardOption = {
  drop: OkeyCard;
  keep: OkeyCard[];
  ev: number;
  probability: number;
  bestOutcome: OkeyCombo | null;
  hitCount: number;
  deckSize: number;
  needCards: OkeyCard[];
};

export type OkeyNearCombo = {
  pair: OkeyCard[];
  needCards: OkeyCard[];
  probability: number;
  ev: number;
  bestScore: number;
  description: string;
};

export type OkeyRecommendation =
  | {
      action: 'play';
      headline: string;
      combo: OkeyCombo;
      futureEv: number;
      totalEv: number;
      residual: OkeyCard[];
      reasoning: string[];
    }
  | {
      action: 'discard-one';
      headline: string;
      drop: OkeyCard;
      keep: OkeyCard[];
      ev: number;
      probability: number;
      needCards: OkeyCard[];
      reasoning: string[];
    }
  | {
      action: 'wait';
      headline: string;
      reasoning: string[];
    };

export type OkeySolveResult = {
  remainingDeck: OkeyCard[];
  immediateCombos: OkeyCombo[];
  playOptions: OkeyPlayOption[];
  singleDiscards: OkeyDiscardOption[];
  nearCombos: OkeyNearCombo[];
  recommendation: OkeyRecommendation;
};

const EXACT_THRESHOLD = 5000;

export function scoreOkeyCombo(cards: OkeyCard[]): OkeyCombo | null {
  if (cards.length !== OKEY_COMBO_SIZE) {
    return null;
  }

  const sorted = [...cards].sort((a, b) => a.number - b.number);
  const numbers = sorted.map((card) => card.number);
  const colors = new Set(cards.map((card) => card.color));
  const isRun = numbers[1] - numbers[0] === 1 && numbers[2] - numbers[1] === 1;
  const isSet = numbers[0] === numbers[1] && numbers[1] === numbers[2];

  if (isRun && colors.size === 1) {
    return {
      cards,
      points: 100,
      description: `Run same colour ${okeyCardLabel(sorted[0])}-${numbers[2]}`,
      kind: 'same-color-run',
    };
  }

  if (isRun) {
    return {
      cards,
      points: 10 * numbers[0],
      description: `Run mixed ${numbers[0]}-${numbers[1]}-${numbers[2]}`,
      kind: 'mixed-run',
    };
  }

  if (isSet && colors.size === 3) {
    return {
      cards,
      points: 10 * (numbers[0] + 1),
      description: `Set all colours ${numbers[0]} x3`,
      kind: 'set',
    };
  }

  return null;
}

export function solveOkey(state: OkeySessionState): OkeySolveResult {
  const remainingDeck = remainingOkeyDeck(state);
  const immediateCombos = allCombosIn(state.hand);
  const playOptions = immediateCombos
    .map((combo) => evaluatePlay(combo, state.hand, remainingDeck))
    .sort((a, b) => b.totalEv - a.totalEv);
  const singleDiscards =
    state.hand.length === OKEY_HAND_SIZE
      ? state.hand.map((card) => evaluateSingleDiscard(card, state.hand, remainingDeck)).sort((a, b) => b.ev - a.ev)
      : [];
  const nearCombos = analyseNearCombos(state.hand, remainingDeck).slice(0, 6);
  const recommendation = recommend(playOptions, singleDiscards, state.hand, remainingDeck);

  return {
    remainingDeck,
    immediateCombos,
    playOptions,
    singleDiscards,
    nearCombos,
    recommendation,
  };
}

export function remainingOkeyDeck(state: OkeySessionState): OkeyCard[] {
  const seen = new Set<string>();

  state.hand.forEach((card) => seen.add(okeyCardId(card)));
  state.discarded.forEach((card) => seen.add(okeyCardId(card)));
  state.scored.forEach((combo) => combo.cards.forEach((card) => seen.add(okeyCardId(card))));

  return ALL_OKEY_CARDS.filter((card) => !seen.has(okeyCardId(card)));
}

function recommend(
  playOptions: OkeyPlayOption[],
  singleDiscards: OkeyDiscardOption[],
  hand: OkeyCard[],
  deck: OkeyCard[],
): OkeyRecommendation {
  if (hand.length < OKEY_HAND_SIZE) {
    const missing = OKEY_HAND_SIZE - hand.length;

    return {
      action: 'wait',
      headline: `Waiting for ${missing} more card${missing === 1 ? '' : 's'}`,
      reasoning: ['The observed hand is not full yet, so no discard is needed.'],
    };
  }

  const bestPlay = playOptions[0] ?? null;
  const bestDiscard = singleDiscards[0] ?? null;

  if (bestPlay) {
    const playTotal = bestPlay.totalEv;
    const discardEv = bestDiscard?.ev ?? 0;
    const reasoning = [
      `Best playable combo is ${bestPlay.combo.description} for ${bestPlay.combo.points} points.`,
      `Residual hand projects ${bestPlay.futureEv.toFixed(1)} future EV.`,
    ];

    if (bestDiscard && discardEv > playTotal + 10 && deck.length >= 6) {
      reasoning.push(`Discarding ${okeyCardLabel(bestDiscard.drop)} has higher continuation EV (${discardEv.toFixed(1)}).`);

      return discardRecommendation(bestDiscard, reasoning);
    }

    reasoning.push('Take the certain score now.');

    return {
      action: 'play',
      headline: `Play ${bestPlay.combo.cards.map(okeyCardLabel).join(' + ')} for ${bestPlay.combo.points}`,
      combo: bestPlay.combo,
      futureEv: bestPlay.futureEv,
      totalEv: bestPlay.totalEv,
      residual: bestPlay.residual,
      reasoning,
    };
  }

  if (bestDiscard) {
    return discardRecommendation(bestDiscard, [
      `No valid combo is available.`,
      `Discarding ${okeyCardLabel(bestDiscard.drop)} gives the best one-card EV (${bestDiscard.ev.toFixed(1)}).`,
    ]);
  }

  return {
    action: 'wait',
    headline: 'Waiting for a readable hand',
    reasoning: ['Start capture or confirm the current cards to unlock recommendations.'],
  };
}

function discardRecommendation(option: OkeyDiscardOption, reasoning: string[]): OkeyRecommendation {
  if (option.needCards.length) {
    reasoning.push(`Best next hits include ${option.needCards.slice(0, 3).map(okeyCardLabel).join(', ')}.`);
  }

  return {
    action: 'discard-one',
    headline: `Discard ${okeyCardLabel(option.drop)}`,
    drop: option.drop,
    keep: option.keep,
    ev: option.ev,
    probability: option.probability,
    needCards: option.needCards,
    reasoning,
  };
}

function evaluatePlay(combo: OkeyCombo, hand: OkeyCard[], deck: OkeyCard[]): OkeyPlayOption {
  const comboIds = new Set(combo.cards.map(okeyCardId));
  const residual = hand.filter((card) => !comboIds.has(okeyCardId(card)));
  const drawCount = Math.min(OKEY_HAND_SIZE - residual.length, deck.length);
  const futureEv = expectedBestCombo(residual, deck, drawCount);

  return {
    combo,
    futureEv,
    totalEv: combo.points + futureEv,
    residual,
  };
}

function evaluateSingleDiscard(drop: OkeyCard, hand: OkeyCard[], deck: OkeyCard[]): OkeyDiscardOption {
  const keep = hand.filter((card) => okeyCardId(card) !== okeyCardId(drop));

  if (!deck.length) {
    const best = bestComboIn(keep);

    return {
      drop,
      keep,
      ev: best?.points ?? 0,
      probability: best ? 1 : 0,
      bestOutcome: best,
      hitCount: best ? 1 : 0,
      deckSize: 0,
      needCards: [],
    };
  }

  let total = 0;
  let hits = 0;
  let bestOutcome: OkeyCombo | null = null;

  deck.forEach((drawn) => {
    const best = bestComboIn([...keep, drawn]);

    if (best) {
      total += best.points;
      hits += 1;
      if (!bestOutcome || best.points > bestOutcome.points) {
        bestOutcome = best;
      }
    }
  });

  return {
    drop,
    keep,
    ev: total / deck.length,
    probability: hits / deck.length,
    bestOutcome,
    hitCount: hits,
    deckSize: deck.length,
    needCards: helpfulCompleters(keep, deck).slice(0, 6),
  };
}

function expectedBestCombo(base: OkeyCard[], deck: OkeyCard[], drawCount: number): number {
  if (drawCount <= 0) {
    return bestComboIn(base)?.points ?? 0;
  }

  if (drawCount > deck.length) {
    return 0;
  }

  const samples = combinations(deck, drawCount);
  const exactSamples = samples.length <= EXACT_THRESHOLD ? samples : samples.slice(0, EXACT_THRESHOLD);
  const total = exactSamples.reduce((sum, sample) => sum + (bestComboIn([...base, ...sample])?.points ?? 0), 0);

  return exactSamples.length ? total / exactSamples.length : 0;
}

function analyseNearCombos(hand: OkeyCard[], deck: OkeyCard[]): OkeyNearCombo[] {
  return combinations(hand, 2)
    .map((pair) => {
      const completers = completingCards(pair);
      const needCards = completers.filter((card) => deck.some((deckCard) => okeyCardId(deckCard) === okeyCardId(card)));
      const bestScore = Math.max(0, ...needCards.map((card) => scoreOkeyCombo([...pair, card])?.points ?? 0));
      const probability = hyperProbability(deck.length, needCards.length, OKEY_HAND_SIZE - pair.length);

      return {
        pair,
        needCards,
        probability,
        ev: probability * bestScore,
        bestScore,
        description: `${pair.map(okeyCardLabel).join(' + ')} needs ${needCards.slice(0, 3).map(okeyCardLabel).join(', ')}`,
      };
    })
    .filter((near) => near.needCards.length > 0)
    .sort((a, b) => b.ev - a.ev);
}

function completingCards(pair: OkeyCard[]): OkeyCard[] {
  return ALL_OKEY_CARDS.filter((candidate) => {
    if (pair.some((card) => okeyCardId(card) === okeyCardId(candidate))) {
      return false;
    }

    return scoreOkeyCombo([...pair, candidate]) != null;
  });
}

function helpfulCompleters(base: OkeyCard[], deck: OkeyCard[]): OkeyCard[] {
  const current = bestComboIn(base)?.points ?? 0;

  return deck
    .map((card) => ({ card, score: bestComboIn([...base, card])?.points ?? 0 }))
    .filter((entry) => entry.score > current)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.card);
}

function allCombosIn(cards: OkeyCard[]): OkeyCombo[] {
  return combinations(cards, OKEY_COMBO_SIZE)
    .map(scoreOkeyCombo)
    .filter((combo): combo is OkeyCombo => combo != null)
    .sort((a, b) => b.points - a.points);
}

function bestComboIn(cards: OkeyCard[]): OkeyCombo | null {
  return allCombosIn(cards)[0] ?? null;
}

function combinations<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  const current: T[] = [];

  const walk = (start: number) => {
    if (current.length === size) {
      output.push([...current]);
      return;
    }

    for (let index = start; index <= items.length - (size - current.length); index++) {
      current.push(items[index]);
      walk(index + 1);
      current.pop();
    }
  };

  walk(0);

  return output;
}

function hyperProbability(total: number, winners: number, draws: number): number {
  if (total <= 0 || winners <= 0 || draws <= 0) {
    return 0;
  }

  const safeDraws = Math.min(draws, total);
  const miss = choose(total - winners, safeDraws);
  const all = choose(total, safeDraws);

  return all ? 1 - miss / all : 0;
}

function choose(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) {
    return 0;
  }

  const smallK = Math.min(k, n - k);
  let result = 1;

  for (let index = 1; index <= smallK; index++) {
    result = (result * (n - smallK + index)) / index;
  }

  return result;
}
