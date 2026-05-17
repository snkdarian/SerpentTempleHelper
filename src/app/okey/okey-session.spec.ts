import { OkeyCard } from './okey-types';
import { applyObservedOkeyHand, confirmInitialOkeyHand, inferOkeyHandChange } from './okey-session';

const c = (color: OkeyCard['color'], number: OkeyCard['number']): OkeyCard => ({ color, number });

describe('Okey session inference', () => {
  it('infers a one-card discard and draw', () => {
    const previous = [c('yellow', 1), c('yellow', 2), c('red', 4), c('blue', 5), c('red', 8)];
    const next = [c('yellow', 1), c('yellow', 2), c('red', 4), c('blue', 5), c('blue', 8)];

    const result = inferOkeyHandChange(previous, next);

    expect(result.kind).toBe('discard-one');
  });

  it('infers a played combo when three valid cards are replaced', () => {
    const previous = [c('yellow', 6), c('yellow', 7), c('yellow', 8), c('blue', 1), c('red', 2)];
    const next = [c('blue', 3), c('red', 4), c('yellow', 5), c('blue', 1), c('red', 2)];

    const result = inferOkeyHandChange(previous, next);

    expect(result.kind).toBe('play-combo');
    if (result.kind === 'play-combo') {
      expect(result.points).toBe(100);
    }
  });

  it('pauses on ambiguous multi-card changes', () => {
    const previous = [c('yellow', 1), c('yellow', 4), c('red', 4), c('blue', 5), c('red', 8)];
    const next = [c('yellow', 2), c('yellow', 3), c('red', 6), c('blue', 5), c('red', 8)];

    expect(inferOkeyHandChange(previous, next).kind).toBe('ambiguous');
  });

  it('updates score and deck memory after an inferred play', () => {
    const state = confirmInitialOkeyHand([
      c('yellow', 6),
      c('yellow', 7),
      c('yellow', 8),
      c('blue', 1),
      c('red', 2),
    ]);

    const applied = applyObservedOkeyHand(state, [
      c('blue', 3),
      c('red', 4),
      c('yellow', 5),
      c('blue', 1),
      c('red', 2),
    ]);

    expect(applied.inference.kind).toBe('play-combo');
    expect(applied.state.totalScore).toBe(100);
    expect(applied.state.scored.length).toBe(1);
  });

  it('rejects detected hands that reuse discarded cards', () => {
    const state = confirmInitialOkeyHand([
      c('yellow', 1),
      c('yellow', 2),
      c('red', 4),
      c('blue', 5),
      c('red', 8),
    ]);
    const afterDiscard = applyObservedOkeyHand(state, [
      c('yellow', 1),
      c('yellow', 2),
      c('red', 4),
      c('blue', 5),
      c('blue', 8),
    ]).state;

    const reusedDiscard = applyObservedOkeyHand(afterDiscard, [
      c('yellow', 1),
      c('yellow', 2),
      c('red', 4),
      c('blue', 5),
      c('red', 8),
    ]);

    expect(reusedDiscard.inference.kind).toBe('ambiguous');
    expect(reusedDiscard.state).toBe(afterDiscard);
  });
});
