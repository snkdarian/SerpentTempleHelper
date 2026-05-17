import { splitOkeyRoi } from './okey-detection';

describe('Okey detection helpers', () => {
  it('splits the selected hand area into five equal slots', () => {
    const slots = splitOkeyRoi({ x: 10, y: 20, width: 500, height: 100 });

    expect(slots.length).toBe(5);
    expect(slots[0]).toEqual({ slot: 0, x: 10, y: 20, width: 100, height: 100 });
    expect(slots[4]).toEqual({ slot: 4, x: 410, y: 20, width: 100, height: 100 });
  });
});
