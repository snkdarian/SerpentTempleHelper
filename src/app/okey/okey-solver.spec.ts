import { OkeyCard } from './okey-types';
import { confirmInitialOkeyHand } from './okey-session';
import { scoreOkeyCombo, solveOkey } from './okey-solver';

const c = (color: OkeyCard['color'], number: OkeyCard['number']): OkeyCard => ({ color, number });

describe('Okey solver', () => {
  it('scores Metin2 Okey combo rules', () => {
    expect(scoreOkeyCombo([c('yellow', 6), c('yellow', 7), c('yellow', 8)])?.points).toBe(100);
    expect(scoreOkeyCombo([c('yellow', 3), c('red', 4), c('blue', 5)])?.points).toBe(30);
    expect(scoreOkeyCombo([c('yellow', 5), c('red', 5), c('blue', 5)])?.points).toBe(60);
    expect(scoreOkeyCombo([c('yellow', 5), c('red', 5), c('yellow', 5)])).toBeNull();
  });

  it('recommends playing a strong immediate combo', () => {
    const state = confirmInitialOkeyHand([
      c('yellow', 6),
      c('yellow', 7),
      c('yellow', 8),
      c('red', 1),
      c('blue', 4),
    ]);

    const result = solveOkey(state);

    expect(result.recommendation.action).toBe('play');
    expect(result.playOptions[0].combo.points).toBe(100);
  });

  it('ranks single-card discards when no combo is ready', () => {
    const state = confirmInitialOkeyHand([
      c('yellow', 6),
      c('yellow', 7),
      c('red', 1),
      c('blue', 4),
      c('red', 3),
    ]);

    const result = solveOkey(state);

    expect(result.recommendation.action).toBe('discard-one');
    expect(result.singleDiscards.length).toBe(5);
    expect(result.nearCombos[0].needCards.length).toBeGreaterThan(0);
  });
});
