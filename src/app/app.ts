import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { OkeyCardComponent } from './okey/okey-card.component';

type ElementKey = 'pamant' | 'foc' | 'vant' | 'gheata';
type SymbolCode = 'dj' | 'ss' | 'sm' | 'sj' | 'ds' | 'dm';
type AppTab = 'temple' | 'next' | 'okey';
type CtkCard = '1' | '2' | '3' | '4' | '5' | 'K';
type CtkCellState = 'hidden' | 'revealed';

type CtkCell = {
  state: CtkCellState;
  value: CtkCard | null;
  flashed: boolean;
  scored: boolean;
};

type CtkSnapshot = {
  cells: CtkCell[];
  remaining: Record<CtkCard, number>;
  handIndex: number;
  score: number;
  completedBingos: number[];
};

type CtkState = {
  cells: CtkCell[];
  remaining: Record<CtkCard, number>;
  handIndex: number;
  score: number;
  completedBingos: Set<number>;
  history: CtkSnapshot[];
};

type CtkSuggestion = {
  cellIdx: number;
  score: number;
  reason: string;
  kind: 'flip' | 'catch';
};

type TempleElement = {
  key: ElementKey;
  label: string;
  tone: string;
  icon: 'earth' | 'fire' | 'wind' | 'ice';
};

type TempleRoute = {
  elements: ElementKey[];
  symbols: SymbolCode[];
};

type SymbolPosition = {
  code: SymbolCode;
  column: 1 | 2;
  row: 1 | 2 | 3;
  sideLabel: 'Stanga' | 'Dreapta';
  levelLabel: 'Sus' | 'Mijloc' | 'Jos';
};

const STORAGE_KEY = 'serpent-temple-session';
const CTK_GRID_SIZE = 5;
const CTK_CELL_COUNT = CTK_GRID_SIZE * CTK_GRID_SIZE;
const CTK_VALUES: CtkCard[] = ['1', '2', '3', '4', '5', 'K'];
const CTK_BOARD_COUNTS: Record<CtkCard, number> = { 1: 7, 2: 4, 3: 5, 4: 5, 5: 3, K: 1 };
const CTK_HAND_SEQUENCE: CtkCard[] = ['1', '1', '1', '1', '1', '2', '2', '3', '3', '4', '5', 'K'];
const CTK_OPENING_PATTERN = [6, 8, 16, 18];
const CTK_GOLD_TARGET = 550;

const ELEMENTS: TempleElement[] = [
  { key: 'pamant', label: 'Pamant', tone: '#d8d000', icon: 'earth' },
  { key: 'foc', label: 'Foc', tone: '#ff3030', icon: 'fire' },
  { key: 'vant', label: 'Vant', tone: '#19d452', icon: 'wind' },
  { key: 'gheata', label: 'Gheata', tone: '#2236ff', icon: 'ice' },
];

const ROUTES: Record<ElementKey, TempleRoute> = {
  pamant: {
    elements: ['pamant', 'foc', 'vant', 'gheata'],
    symbols: ['dj', 'ss', 'sm', 'sj', 'ds', 'dm'],
  },
  vant: {
    elements: ['vant', 'pamant', 'gheata', 'foc'],
    symbols: ['ss', 'sm', 'sj', 'ds', 'dm', 'dj'],
  },
  foc: {
    elements: ['foc', 'gheata', 'vant', 'pamant'],
    symbols: ['ds', 'dm', 'dj', 'ss', 'sm', 'sj'],
  },
  gheata: {
    elements: ['gheata', 'pamant', 'foc', 'vant'],
    symbols: ['dm', 'dj', 'ss', 'sm', 'sj', 'ds'],
  },
};

const SYMBOL_POSITIONS: Record<SymbolCode, SymbolPosition> = {
  ss: { code: 'ss', column: 1, row: 1, sideLabel: 'Stanga', levelLabel: 'Sus' },
  sm: { code: 'sm', column: 1, row: 2, sideLabel: 'Stanga', levelLabel: 'Mijloc' },
  sj: { code: 'sj', column: 1, row: 3, sideLabel: 'Stanga', levelLabel: 'Jos' },
  ds: { code: 'ds', column: 2, row: 1, sideLabel: 'Dreapta', levelLabel: 'Sus' },
  dm: { code: 'dm', column: 2, row: 2, sideLabel: 'Dreapta', levelLabel: 'Mijloc' },
  dj: { code: 'dj', column: 2, row: 3, sideLabel: 'Dreapta', levelLabel: 'Jos' },
};

const CTK_NEIGHBORS: number[][] = (() => {
  const out: number[][] = [];

  for (let idx = 0; idx < CTK_CELL_COUNT; idx++) {
    const row = Math.floor(idx / CTK_GRID_SIZE);
    const col = idx % CTK_GRID_SIZE;
    const neighbors: number[] = [];

    for (let rowDelta = -1; rowDelta <= 1; rowDelta++) {
      for (let colDelta = -1; colDelta <= 1; colDelta++) {
        if (rowDelta === 0 && colDelta === 0) {
          continue;
        }

        const nextRow = row + rowDelta;
        const nextCol = col + colDelta;

        if (nextRow < 0 || nextRow >= CTK_GRID_SIZE || nextCol < 0 || nextCol >= CTK_GRID_SIZE) {
          continue;
        }

        neighbors.push(nextRow * CTK_GRID_SIZE + nextCol);
      }
    }

    out.push(neighbors);
  }

  return out;
})();

const CTK_BINGO_LINES: number[][] = (() => {
  const lines: number[][] = [];

  for (let row = 0; row < CTK_GRID_SIZE; row++) {
    lines.push(Array.from({ length: CTK_GRID_SIZE }, (_, col) => row * CTK_GRID_SIZE + col));
  }

  for (let col = 0; col < CTK_GRID_SIZE; col++) {
    lines.push(Array.from({ length: CTK_GRID_SIZE }, (_, row) => row * CTK_GRID_SIZE + col));
  }

  lines.push(
    Array.from({ length: CTK_GRID_SIZE }, (_, index) => index * CTK_GRID_SIZE + index),
    Array.from({ length: CTK_GRID_SIZE }, (_, index) => index * CTK_GRID_SIZE + (CTK_GRID_SIZE - 1 - index)),
  );

  return lines;
})();

type SavedSession = {
  selectedElement: ElementKey;
  selectedAt: string;
};

type CtkDeckSummary = {
  value: CtkCard;
  total: number;
  remaining: number;
  used: number;
  points: number;
  note: string;
};

@Component({
  selector: 'app-root',
  imports: [OkeyCardComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    '(window:keydown)': 'handleKeydown($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly elements = ELEMENTS;
  protected readonly activeTab = signal<AppTab>('temple');
  protected readonly selectedElement = signal<ElementKey | null>(this.readSavedElement());
  protected readonly ctkState = signal<CtkState>(this.createCtkState());
  protected readonly selectedCtkCell = signal<number | null>(null);
  protected readonly hoveredCtkCell = signal<number | null>(null);

  protected readonly selectedElementInfo = computed(() => {
    const selected = this.selectedElement();

    return selected ? this.elementByKey(selected) : null;
  });

  protected readonly selectedRoute = computed(() => {
    const selected = this.selectedElement();

    return selected ? ROUTES[selected] : null;
  });

  protected readonly sequenceSteps = computed(() => {
    const route = this.selectedRoute();

    if (!route) {
      return [];
    }

    return [
      ...route.elements.map((key) => ({
        id: key,
        label: this.elementByKey(key).label,
        tone: this.elementByKey(key).tone,
        type: 'element' as const,
      })),
      ...route.symbols.map((symbol) => ({
        id: symbol,
        label: symbol,
        tone: '#a7aaa0',
        type: 'symbol' as const,
      })),
    ];
  });

  protected readonly elementSequenceSteps = computed(() => {
    const route = this.selectedRoute();

    if (!route) {
      return [];
    }

    return route.elements.map((key, index) => ({
      id: key,
      label: this.elementByKey(key).label,
      tone: this.elementByKey(key).tone,
      order: index + 1,
    }));
  });

  protected readonly boardMarkers = computed(() => {
    const route = this.selectedRoute();

    if (!route) {
      return [];
    }

    return route.symbols.map((symbol, index) => ({
      ...SYMBOL_POSITIONS[symbol],
      order: index + 1,
    }));
  });

  protected readonly ctkCurrentCard = computed(() => this.currentCtkCard(this.ctkState()));
  protected readonly ctkFiveProbabilities = computed(() => this.fiveProbabilities(this.ctkState()));
  protected readonly ctkDistribution = computed(() => this.cellValueDistribution(this.ctkState()));
  protected readonly ctkSuggestion = computed(() => this.suggestCtkMove(this.ctkState()));
  protected readonly ctkMaxPossible = computed(() => this.maxPossibleRemaining(this.ctkState()));
  protected readonly ctkHiddenCount = computed(() => this.hiddenCtkCells(this.ctkState()).length);
  protected readonly ctkDeckSummary = computed<CtkDeckSummary[]>(() => {
    const state = this.ctkState();

    return CTK_VALUES.map((value) => ({
      value,
      total: CTK_BOARD_COUNTS[value],
      remaining: state.remaining[value],
      used: CTK_BOARD_COUNTS[value] - state.remaining[value],
      points: this.ctkCardPoints(value),
      note: this.ctkDeckNote(value),
    }));
  });
  protected readonly ctkStatusTone = computed(() => {
    const state = this.ctkState();
    const maxScore = state.score + this.ctkMaxPossible();

    if (state.score >= CTK_GOLD_TARGET) {
      return 'gold';
    }

    return maxScore < CTK_GOLD_TARGET ? 'danger' : 'live';
  });

  protected readonly ctkCells = computed(() => {
    const state = this.ctkState();
    const pFive = this.ctkFiveProbabilities();
    const distribution = this.ctkDistribution();
    const suggestion = this.ctkSuggestion();
    const hand = this.ctkCurrentCard();

    return state.cells.map((cell, idx) => {
      const dist = distribution.get(idx);
      const certainValue = dist
        ? CTK_VALUES.find((value) => (dist[value] ?? 0) >= 0.999)
        : undefined;

      return {
        ...cell,
        idx,
        label: idx + 1,
        row: Math.floor(idx / CTK_GRID_SIZE) + 1,
        col: (idx % CTK_GRID_SIZE) + 1,
        pFive: pFive.get(idx) ?? 0,
        pKing: dist?.K ?? 0,
        certainValue,
        selected: this.selectedCtkCell() === idx,
        suggested: suggestion?.cellIdx === idx,
        catchable: cell.state === 'revealed' && !cell.scored && hand != null && this.compareCtkHand(hand, cell.value ?? '1') !== 'lose',
        safeForFive: cell.state === 'hidden' && this.isSafeFor5Turn(state, idx, pFive),
      };
    });
  });

  protected selectElement(key: ElementKey): void {
    this.selectedElement.set(key);
    this.saveSession(key);
  }

  protected resetSelection(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.selectedElement.set(null);
  }

  protected selectTab(tab: AppTab): void {
    this.activeTab.set(tab);
  }

  protected selectCtkCell(cellIdx: number): void {
    const state = this.ctkState();
    const cell = state.cells[cellIdx];

    if (cell.state === 'revealed' && !cell.scored) {
      this.catchCtkCell(cellIdx);
      return;
    }

    this.selectedCtkCell.set(cellIdx);
  }

  protected hoverCtkCell(cellIdx: number | null): void {
    this.hoveredCtkCell.set(cellIdx);
  }

  private revealCtkCell(cellIdx: number, value: CtkCard, flashed: boolean): void {
    const state = this.cloneCtkState(this.ctkState());
    const result = this.recordCtkReveal(state, cellIdx, value, flashed);

    if (!result) {
      return;
    }

    this.ctkState.set(state);
    this.selectedCtkCell.set(null);
  }

  protected undoCtk(): void {
    const state = this.cloneCtkState(this.ctkState());
    const last = state.history.pop();

    if (!last) {
      return;
    }

    this.ctkState.set(this.restoreCtkSnapshot(last, state.history));
  }

  protected resetCtk(): void {
    const state = this.createCtkState();

    this.ctkState.set(state);
    this.selectedCtkCell.set(null);
    this.hoveredCtkCell.set(null);
  }

  protected ctkPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  protected ctkCardPoints(value: CtkCard): number {
    return value === 'K' ? 100 : Number(value) * 10;
  }

  protected handleKeydown(event: KeyboardEvent): void {
    if (this.activeTab() !== 'next') {
      return;
    }

    const key = event.key.toUpperCase();

    if (key === 'BACKSPACE') {
      event.preventDefault();
      this.undoCtk();
      return;
    }

    if (key === 'ESCAPE') {
      event.preventDefault();
      this.resetCtk();
      return;
    }

    const value = key === '6' ? 'K' : (key as CtkCard);

    if (CTK_VALUES.includes(value)) {
      const hoveredCell = this.hoveredCtkCell();

      if (hoveredCell == null) {
        return;
      }

      event.preventDefault();
      this.revealCtkCell(hoveredCell, value, event.shiftKey);
    }
  }

  private createCtkState(): CtkState {
    return {
      cells: Array.from({ length: CTK_CELL_COUNT }, () => ({
        state: 'hidden',
        value: null,
        flashed: false,
        scored: false,
      })),
      remaining: { ...CTK_BOARD_COUNTS },
      handIndex: 0,
      score: 0,
      completedBingos: new Set<number>(),
      history: [],
    };
  }

  private cloneCtkState(state: CtkState): CtkState {
    return {
      cells: state.cells.map((cell) => ({ ...cell })),
      remaining: { ...state.remaining },
      handIndex: state.handIndex,
      score: state.score,
      completedBingos: new Set(state.completedBingos),
      history: state.history.map((snapshot) => ({
        cells: snapshot.cells.map((cell) => ({ ...cell })),
        remaining: { ...snapshot.remaining },
        handIndex: snapshot.handIndex,
        score: snapshot.score,
        completedBingos: [...snapshot.completedBingos],
      })),
    };
  }

  private snapshotCtkState(state: CtkState): CtkSnapshot {
    return {
      cells: state.cells.map((cell) => ({ ...cell })),
      remaining: { ...state.remaining },
      handIndex: state.handIndex,
      score: state.score,
      completedBingos: [...state.completedBingos],
    };
  }

  private restoreCtkSnapshot(snapshot: CtkSnapshot, history: CtkSnapshot[]): CtkState {
    return {
      cells: snapshot.cells.map((cell) => ({ ...cell })),
      remaining: { ...snapshot.remaining },
      handIndex: snapshot.handIndex,
      score: snapshot.score,
      completedBingos: new Set(snapshot.completedBingos),
      history,
    };
  }

  private currentCtkCard(state: CtkState): CtkCard | null {
    return CTK_HAND_SEQUENCE[state.handIndex] ?? null;
  }

  private hiddenCtkCells(state: CtkState): number[] {
    return state.cells.flatMap((cell, idx) => (cell.state === 'hidden' ? [idx] : []));
  }

  private numericCtkValue(value: CtkCard): number {
    return value === 'K' ? 6 : Number(value);
  }

  private compareCtkHand(hand: CtkCard, revealed: CtkCard): 'score' | 'chain' | 'lose' {
    if (hand === 'K') {
      return revealed === 'K' ? 'score' : 'lose';
    }

    if (revealed === 'K') {
      return 'lose';
    }

    const handValue = this.numericCtkValue(hand);
    const revealedValue = this.numericCtkValue(revealed);

    if (revealedValue < handValue) {
      return 'chain';
    }

    return revealedValue === handValue ? 'score' : 'lose';
  }

  private deriveCtkConstraints(state: CtkState): { mustNotBe5: Set<number>; constraints: number[][] } {
    const mustNotBe5 = new Set<number>();
    const rawConstraints: number[][] = [];

    state.cells.forEach((cell, idx) => {
      if (cell.state !== 'revealed') {
        return;
      }

      if (cell.flashed) {
        const explainedByRevealedFive = CTK_NEIGHBORS[idx].some((neighbor) => {
          const neighborCell = state.cells[neighbor];

          return neighborCell.state === 'revealed' && neighborCell.value === '5';
        });

        if (!explainedByRevealedFive) {
          rawConstraints.push(CTK_NEIGHBORS[idx].filter((neighbor) => state.cells[neighbor].state === 'hidden'));
        }

        return;
      }

      CTK_NEIGHBORS[idx].forEach((neighbor) => {
        if (state.cells[neighbor].state === 'hidden') {
          mustNotBe5.add(neighbor);
        }
      });
    });

    return {
      mustNotBe5,
      constraints: rawConstraints
        .map((constraint) => constraint.filter((cellIdx) => !mustNotBe5.has(cellIdx)))
        .filter((constraint) => constraint.length > 0),
    };
  }

  private enumerateFivePlacements(state: CtkState): number[][] {
    const { mustNotBe5, constraints } = this.deriveCtkConstraints(state);
    const candidates = this.hiddenCtkCells(state).filter((idx) => !mustNotBe5.has(idx));
    const needed = state.remaining['5'];
    const result: number[][] = [];
    const current: number[] = [];

    if (needed < 0 || needed > candidates.length) {
      return result;
    }

    const satisfiesConstraints = () =>
      constraints.every((constraint) => constraint.some((cellIdx) => current.includes(cellIdx)));

    const recurse = (start: number, remaining: number) => {
      if (remaining === 0) {
        if (satisfiesConstraints()) {
          result.push([...current]);
        }

        return;
      }

      const left = candidates.length - start;

      if (left < remaining) {
        return;
      }

      for (let index = start; index <= candidates.length - remaining; index++) {
        current.push(candidates[index]);
        recurse(index + 1, remaining - 1);
        current.pop();
      }
    };

    recurse(0, needed);

    return result;
  }

  private fiveProbabilities(state: CtkState): Map<number, number> {
    const { mustNotBe5 } = this.deriveCtkConstraints(state);
    const hidden = this.hiddenCtkCells(state);
    const candidates = hidden.filter((idx) => !mustNotBe5.has(idx));
    const probabilities = new Map<number, number>();

    hidden.forEach((idx) => probabilities.set(idx, 0));

    if (state.remaining['5'] === 0 || candidates.length === 0) {
      return probabilities;
    }

    const placements = this.enumerateFivePlacements(state);

    if (placements.length === 0) {
      const fallback = Math.min(1, state.remaining['5'] / candidates.length);
      candidates.forEach((idx) => probabilities.set(idx, fallback));

      return probabilities;
    }

    candidates.forEach((idx) => probabilities.set(idx, 0));
    placements.forEach((placement) => {
      placement.forEach((idx) => probabilities.set(idx, (probabilities.get(idx) ?? 0) + 1));
    });
    candidates.forEach((idx) => probabilities.set(idx, (probabilities.get(idx) ?? 0) / placements.length));

    return probabilities;
  }

  private cellValueDistribution(state: CtkState): Map<number, Record<CtkCard, number>> {
    const pFive = this.fiveProbabilities(state);
    const hidden = this.hiddenCtkCells(state);
    const nonFiveSlots = hidden.length - state.remaining['5'];
    const distribution = new Map<number, Record<CtkCard, number>>();

    hidden.forEach((idx) => {
      const p5 = pFive.get(idx) ?? 0;
      const row: Record<CtkCard, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: p5, K: 0 };

      if (nonFiveSlots > 0) {
        const notFive = 1 - p5;

        (['1', '2', '3', '4', 'K'] as CtkCard[]).forEach((value) => {
          row[value] = notFive * (state.remaining[value] / nonFiveSlots);
        });
      }

      distribution.set(idx, row);
    });

    return distribution;
  }

  private isSafeFor5Turn(state: CtkState, cellIdx: number, pFive = this.fiveProbabilities(state)): boolean {
    return CTK_NEIGHBORS[cellIdx].every((neighbor) => {
      const cell = state.cells[neighbor];

      if (cell.state === 'revealed') {
        return cell.value !== '5';
      }

      return (pFive.get(neighbor) ?? 0) <= 0.001;
    });
  }

  private checkCtkBingos(state: CtkState, cellIdx: number): number {
    let gained = 0;

    CTK_BINGO_LINES.forEach((line, lineIdx) => {
      if (state.completedBingos.has(lineIdx) || !line.includes(cellIdx)) {
        return;
      }

      const complete = line.every((idx) => {
        const cell = state.cells[idx];

        return cell.state === 'revealed' && cell.scored;
      });

      if (complete) {
        state.completedBingos.add(lineIdx);
        gained += 10;
      }
    });

    return gained;
  }

  private recordCtkReveal(state: CtkState, cellIdx: number, value: CtkCard, flashed: boolean): boolean {
    const cell = state.cells[cellIdx];
    const hand = this.currentCtkCard(state);

    if (cell.state !== 'hidden' || !hand || state.remaining[value] <= 0) {
      return false;
    }

    state.history.push(this.snapshotCtkState(state));
    cell.state = 'revealed';
    cell.value = value;
    cell.flashed = flashed;
    state.remaining[value] -= 1;

    let gained = 0;
    let scored = false;
    let turnEnds = false;

    if (hand === '5' && flashed) {
      turnEnds = true;
    } else {
      const result = this.compareCtkHand(hand, value);

      if (result === 'score') {
        gained += this.ctkCardPoints(value);
        scored = true;
        turnEnds = true;
      } else if (result === 'chain') {
        gained += this.ctkCardPoints(value);
        scored = true;
      } else {
        turnEnds = true;
      }
    }

    cell.scored = scored;
    gained += scored ? this.checkCtkBingos(state, cellIdx) : 0;
    state.score += gained;

    if (turnEnds) {
      state.handIndex += 1;
    }

    return true;
  }

  private catchCtkCell(cellIdx: number): void {
    const state = this.cloneCtkState(this.ctkState());
    const cell = state.cells[cellIdx];
    const hand = this.currentCtkCard(state);

    if (cell.state !== 'revealed' || cell.scored || !hand || !cell.value) {
      return;
    }

    const result = this.compareCtkHand(hand, cell.value);

    if (result === 'lose' || (hand === '5' && !this.isSafeFor5Turn(state, cellIdx))) {
      this.selectedCtkCell.set(cellIdx);
      return;
    }

    state.history.push(this.snapshotCtkState(state));
    cell.scored = true;
    let gained = this.ctkCardPoints(cell.value);
    gained += this.checkCtkBingos(state, cellIdx);
    state.score += gained;

    if (result === 'score') {
      state.handIndex += 1;
    }

    this.ctkState.set(state);
    this.selectedCtkCell.set(null);
  }

  private ctkDeckNote(value: CtkCard): string {
    switch (value) {
      case '5':
        return 'flash si risc la tura de 5';
      case 'K':
        return '100 puncte pe ultima carte';
      default:
        return `${this.ctkCardPoints(value)} puncte`;
    }
  }

  private suggestCtkMove(state: CtkState): CtkSuggestion | null {
    const hand = this.currentCtkCard(state);

    if (!hand) {
      return null;
    }

    const openerDeviated = state.cells.some(
      (cell, idx) => cell.state === 'revealed' && !CTK_OPENING_PATTERN.includes(idx),
    );

    if (hand === '1' && state.handIndex < CTK_OPENING_PATTERN.length && !openerDeviated) {
      const nextOpener = CTK_OPENING_PATTERN.find((idx) => state.cells[idx].state === 'hidden');

      if (nextOpener != null) {
        return {
          cellIdx: nextOpener,
          score: 0,
          kind: 'flip',
          reason: 'Deschidere standard: acopera tabla astfel incat 5-urile sa devina vizibile prin flash.',
        };
      }
    }

    if (hand === 'K' && state.remaining.K === 0) {
      const kingCell = state.cells.findIndex((cell) => cell.state === 'revealed' && cell.value === 'K' && !cell.scored);

      if (kingCell >= 0) {
        return { cellIdx: kingCell, score: 100, kind: 'catch', reason: 'Regele este deja descoperit: click pentru +100.' };
      }
    }

    let bestChainCatch: { cellIdx: number; value: CtkCard } | null = null;

    for (let idx = 0; idx < state.cells.length; idx++) {
      const cell = state.cells[idx];

      if (cell.state !== 'revealed' || cell.scored || !cell.value) {
        continue;
      }

      if (this.compareCtkHand(hand, cell.value) !== 'chain') {
        continue;
      }

      if (hand === '5' && !this.isSafeFor5Turn(state, idx)) {
        continue;
      }

      if (!bestChainCatch || this.ctkCardPoints(cell.value) > this.ctkCardPoints(bestChainCatch.value)) {
        bestChainCatch = { cellIdx: idx, value: cell.value };
      }
    }

    if (bestChainCatch) {
      return {
        cellIdx: bestChainCatch.cellIdx,
        score: this.ctkCardPoints(bestChainCatch.value),
        kind: 'catch',
        reason: `Prinde ${bestChainCatch.value} pentru chain si puncte sigure.`,
      };
    }

    const distribution = this.cellValueDistribution(state);
    const pFive = this.fiveProbabilities(state);
    const placements = this.enumerateFivePlacements(state);
    let bestCell = -1;
    let bestScore = -Infinity;
    let bestReason = '';

    this.hiddenCtkCells(state).forEach((idx) => {
      const dist = distribution.get(idx);

      if (!dist) {
        return;
      }

      let expected = 0;
      let chainProbability = 0;

      CTK_VALUES.forEach((value) => {
        const probability = dist[value] ?? 0;
        const result = this.compareCtkHand(hand, value);

        if (result === 'score' || result === 'chain') {
          expected += probability * this.ctkCardPoints(value);
        }

        if (result === 'chain') {
          chainProbability += probability;
        }
      });

      const pKing = dist.K ?? 0;
      const bingoBonus = this.ctkBingoLinesCompletedBy(state, idx) * 10;
      const infoBonus = this.infoGainAboutFives(idx, placements) * 20;
      const kHuntBonus = hand !== 'K' ? pKing * Math.min(727, 150 + Math.max(0, CTK_GOLD_TARGET - state.score) * 2.46) : 0;
      const chainBonus = chainProbability * this.averageRemainingCtkPoints(state) * 1.94;
      let score = expected + chainBonus + bingoBonus + infoBonus + kHuntBonus;

      if (hand === '5') {
        score -= this.probAnyNeighborIsFive(state, idx, placements) * 612;
      }

      const centerBias = -Math.hypot(Math.floor(idx / CTK_GRID_SIZE) - 2, (idx % CTK_GRID_SIZE) - 2) * 0.037;
      score += centerBias;

      if (score > bestScore) {
        bestScore = score;
        bestCell = idx;
        bestReason = `EV ${expected.toFixed(1)}, chain ${(chainProbability * 100).toFixed(0)}%, info ${infoBonus.toFixed(1)}${kHuntBonus > 0.5 ? `, K ${kHuntBonus.toFixed(1)}` : ''}.`;
      }
    });

    state.cells.forEach((cell, idx) => {
      if (cell.state !== 'revealed' || cell.scored || !cell.value) {
        return;
      }

      if (this.compareCtkHand(hand, cell.value) !== 'score') {
        return;
      }

      if (hand === '5' && !this.isSafeFor5Turn(state, idx, pFive)) {
        return;
      }

      const futureChainAvailable =
        hand === '2' || hand === '3' || (hand === '4' && this.isSafeFor5Turn(state, idx, pFive));
      const score = futureChainAvailable ? 0 : this.ctkCardPoints(cell.value);

      if (score > bestScore) {
        bestScore = score;
        bestCell = idx;
        bestReason = `Prinde ${cell.value} pentru ${this.ctkCardPoints(cell.value)} puncte.`;
      }
    });

    return bestCell >= 0 ? { cellIdx: bestCell, score: bestScore, kind: 'flip', reason: bestReason } : null;
  }

  private ctkBingoLinesCompletedBy(state: CtkState, cellIdx: number): number {
    return CTK_BINGO_LINES.filter((line, lineIdx) => {
      if (state.completedBingos.has(lineIdx) || !line.includes(cellIdx)) {
        return false;
      }

      return line.every((idx) => {
        if (idx === cellIdx) {
          return true;
        }

        const cell = state.cells[idx];

        return cell.state === 'revealed' && cell.scored;
      });
    }).length;
  }

  private averageRemainingCtkPoints(state: CtkState): number {
    const totalCards = CTK_VALUES.reduce((total, value) => total + state.remaining[value], 0);

    if (!totalCards) {
      return 0;
    }

    return CTK_VALUES.reduce((total, value) => total + state.remaining[value] * this.ctkCardPoints(value), 0) / totalCards;
  }

  private infoGainAboutFives(cellIdx: number, placements: number[][]): number {
    if (placements.length <= 1) {
      return 0;
    }

    const neighbors = new Set(CTK_NEIGHBORS[cellIdx]);
    let inCell = 0;
    let noFlash = 0;
    let flash = 0;

    placements.forEach((placement) => {
      const hasCell = placement.includes(cellIdx);
      const hasNeighbor = placement.some((idx) => neighbors.has(idx));

      if (hasCell) {
        inCell += 1;
      } else if (hasNeighbor) {
        flash += 1;
      } else {
        noFlash += 1;
      }
    });

    const total = placements.length;
    const entropyBefore = Math.log2(total);
    const entropyAfter =
      (inCell > 0 ? (inCell / total) * Math.log2(inCell) : 0) +
      (noFlash > 0 ? (noFlash / total) * Math.log2(noFlash) : 0) +
      (flash > 0 ? (flash / total) * Math.log2(flash) : 0);

    return Math.max(0, entropyBefore - entropyAfter);
  }

  private probAnyNeighborIsFive(state: CtkState, cellIdx: number, placements: number[][]): number {
    if (CTK_NEIGHBORS[cellIdx].some((idx) => state.cells[idx].state === 'revealed' && state.cells[idx].value === '5')) {
      return 1;
    }

    if (placements.length === 0) {
      return 0;
    }

    const neighbors = new Set(CTK_NEIGHBORS[cellIdx]);
    const hits = placements.filter((placement) => placement.some((idx) => neighbors.has(idx))).length;

    return hits / placements.length;
  }

  private maxPossibleRemaining(state: CtkState): number {
    const remainingHands = CTK_HAND_SEQUENCE.slice(state.handIndex);
    const canCatchValue = (value: CtkCard) =>
      remainingHands.some((hand) => {
        const result = this.compareCtkHand(hand, value);

        return result === 'score' || result === 'chain';
      });

    let max = 0;

    state.cells.forEach((cell) => {
      if (cell.state === 'revealed' && !cell.scored && cell.value && canCatchValue(cell.value)) {
        max += this.ctkCardPoints(cell.value);
      }
    });

    CTK_VALUES.forEach((value) => {
      if (canCatchValue(value)) {
        max += state.remaining[value] * this.ctkCardPoints(value);
      }
    });

    max += (CTK_BINGO_LINES.length - state.completedBingos.size) * 10;

    return max;
  }

  private elementByKey(key: ElementKey): TempleElement {
    return ELEMENTS.find((element) => element.key === key) ?? ELEMENTS[0];
  }

  private readSavedElement(): ElementKey | null {
    const rawSession = localStorage.getItem(STORAGE_KEY);

    if (!rawSession) {
      return null;
    }

    try {
      const session = JSON.parse(rawSession) as Partial<SavedSession>;
      const selectedElement = session.selectedElement;

      return selectedElement && this.isElementKey(selectedElement) ? selectedElement : null;
    } catch {
      return null;
    }
  }

  private saveSession(selectedElement: ElementKey): void {
    const session: SavedSession = {
      selectedElement,
      selectedAt: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  private isElementKey(value: string): value is ElementKey {
    return value in ROUTES;
  }
}
