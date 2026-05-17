import {
  OKEY_HAND_SIZE,
  OkeyCard,
  OkeySessionEvent,
  OkeySessionState,
  OkeySessionStateSnapshot,
  sameOkeyCard,
  uniqueOkeyCards,
} from './okey-types';
import { scoreOkeyCombo } from './okey-solver';

export type OkeyInferenceResult =
  | {
      kind: 'no-change';
      message: string;
    }
  | {
      kind: 'discard-one';
      discarded: OkeyCard;
      drawn: OkeyCard;
      message: string;
    }
  | {
      kind: 'play-combo';
      comboCards: OkeyCard[];
      drawn: OkeyCard[];
      points: number;
      message: string;
    }
  | {
      kind: 'ambiguous';
      message: string;
      removed: OkeyCard[];
      added: OkeyCard[];
    };

export function createOkeySession(): OkeySessionState {
  return {
    hand: [],
    discarded: [],
    scored: [],
    totalScore: 0,
    history: [],
    events: [],
  };
}

export function confirmInitialOkeyHand(cards: OkeyCard[]): OkeySessionState {
  if (cards.length !== OKEY_HAND_SIZE || !uniqueOkeyCards(cards)) {
    return createOkeySession();
  }

  return {
    ...createOkeySession(),
    hand: [...cards],
    events: [
      {
        kind: 'initial',
        at: new Date().toISOString(),
        message: 'Initial hand confirmed.',
        cards: [...cards],
      },
    ],
  };
}

export function applyObservedOkeyHand(state: OkeySessionState, nextHand: OkeyCard[]): {
  state: OkeySessionState;
  inference: OkeyInferenceResult;
} {
  const used = usedOkeyCardIds(state);
  const reused = nextHand.filter((card) => used.has(cardKey(card)));

  if (reused.length) {
    return {
      state,
      inference: {
        kind: 'ambiguous',
        message: 'Detected hand includes a card that was already discarded or scored.',
        removed: [],
        added: reused,
      },
    };
  }

  const inference = inferOkeyHandChange(state.hand, nextHand);

  if (inference.kind === 'no-change' || inference.kind === 'ambiguous') {
    return { state, inference };
  }

  const snapshot = snapshotOkeyState(state);
  const at = new Date().toISOString();

  if (inference.kind === 'discard-one') {
    return {
      inference,
      state: {
        ...state,
        hand: [...nextHand],
        discarded: [...state.discarded, inference.discarded],
        history: [...state.history, snapshot],
        events: [...state.events, eventFromInference(inference, at)],
      },
    };
  }

  const combo = scoreOkeyCombo(inference.comboCards);

  if (!combo) {
    return {
      state,
      inference: {
        kind: 'ambiguous',
        message: 'Three cards changed, but the removed cards are not a valid combo.',
        removed: inference.comboCards,
        added: inference.drawn,
      },
    };
  }

  return {
    inference,
    state: {
      ...state,
      hand: [...nextHand],
      scored: [...state.scored, { ...combo, playedAt: at }],
      totalScore: state.totalScore + combo.points,
      history: [...state.history, snapshot],
      events: [...state.events, eventFromInference(inference, at)],
    },
  };
}

function usedOkeyCardIds(state: OkeySessionState): Set<string> {
  const used = new Set<string>();

  state.discarded.forEach((card) => used.add(cardKey(card)));
  state.scored.forEach((combo) => combo.cards.forEach((card) => used.add(cardKey(card))));

  return used;
}

function cardKey(card: OkeyCard): string {
  return `${card.color}-${card.number}`;
}

export function syncOkeyHand(state: OkeySessionState, nextHand: OkeyCard[], message = 'Manual sync.'): OkeySessionState {
  return {
    ...state,
    hand: [...nextHand],
    history: [...state.history, snapshotOkeyState(state)],
    events: [
      ...state.events,
      {
        kind: 'manual-sync',
        at: new Date().toISOString(),
        message,
        cards: [...nextHand],
      },
    ],
  };
}

export function undoOkeySession(state: OkeySessionState): OkeySessionState {
  const last = state.history.at(-1);

  if (!last) {
    return state;
  }

  return {
    ...restoreOkeySnapshot(last),
    history: state.history.slice(0, -1),
  };
}

export function inferOkeyHandChange(previous: OkeyCard[], next: OkeyCard[]): OkeyInferenceResult {
  if (next.length !== OKEY_HAND_SIZE || !uniqueOkeyCards(next)) {
    return {
      kind: 'ambiguous',
      message: 'The detected hand must contain 5 unique cards.',
      removed: [],
      added: [],
    };
  }

  const removed = previous.filter((card) => !next.some((candidate) => sameOkeyCard(candidate, card)));
  const added = next.filter((card) => !previous.some((candidate) => sameOkeyCard(candidate, card)));

  if (removed.length === 0 && added.length === 0) {
    return {
      kind: 'no-change',
      message: 'No visible hand change.',
    };
  }

  if (removed.length === 1 && added.length === 1) {
    return {
      kind: 'discard-one',
      discarded: removed[0],
      drawn: added[0],
      message: 'One card changed, inferred discard and draw.',
    };
  }

  if (removed.length === 3 && added.length === 3) {
    const combo = scoreOkeyCombo(removed);

    if (combo) {
      return {
        kind: 'play-combo',
        comboCards: removed,
        drawn: added,
        points: combo.points,
        message: 'Three cards changed, inferred played combo.',
      };
    }
  }

  return {
    kind: 'ambiguous',
    message: `Observed ${removed.length} removed and ${added.length} added cards.`,
    removed,
    added,
  };
}

function snapshotOkeyState(state: OkeySessionState): OkeySessionStateSnapshot {
  return {
    hand: [...state.hand],
    discarded: [...state.discarded],
    scored: state.scored.map((combo) => ({ ...combo, cards: [...combo.cards] })),
    totalScore: state.totalScore,
    events: state.events.map((event) => ({ ...event, cards: [...event.cards] })),
  };
}

function restoreOkeySnapshot(snapshot: OkeySessionStateSnapshot): OkeySessionState {
  return {
    hand: [...snapshot.hand],
    discarded: [...snapshot.discarded],
    scored: snapshot.scored.map((combo) => ({ ...combo, cards: [...combo.cards] })),
    totalScore: snapshot.totalScore,
    history: [],
    events: snapshot.events.map((event) => ({ ...event, cards: [...event.cards] })),
  };
}

function eventFromInference(inference: Exclude<OkeyInferenceResult, { kind: 'no-change' | 'ambiguous' }>, at: string): OkeySessionEvent {
  if (inference.kind === 'discard-one') {
    return {
      kind: 'discard-one',
      at,
      message: inference.message,
      cards: [inference.discarded, inference.drawn],
    };
  }

  return {
    kind: 'play-combo',
    at,
    message: inference.message,
    cards: [...inference.comboCards, ...inference.drawn],
  };
}
