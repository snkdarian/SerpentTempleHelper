import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

type ElementKey = 'pamant' | 'foc' | 'vant' | 'gheata';
type SymbolCode = 'dj' | 'ss' | 'sm' | 'sj' | 'ds' | 'dm';

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

type SavedSession = {
  selectedElement: ElementKey;
  selectedAt: string;
};

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly elements = ELEMENTS;
  protected readonly selectedElement = signal<ElementKey | null>(this.readSavedElement());

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

  protected selectElement(key: ElementKey): void {
    this.selectedElement.set(key);
    this.saveSession(key);
  }

  protected resetSelection(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.selectedElement.set(null);
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
