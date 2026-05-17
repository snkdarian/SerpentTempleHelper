export const OKEY_COLORS = ['yellow', 'red', 'blue'] as const;
export const OKEY_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const OKEY_HAND_SIZE = 5;
export const OKEY_COMBO_SIZE = 3;

export type OkeyColor = (typeof OKEY_COLORS)[number];
export type OkeyNumber = (typeof OKEY_NUMBERS)[number];

export type OkeyCard = {
  color: OkeyColor;
  number: OkeyNumber;
};

export type OkeyCombo = {
  cards: OkeyCard[];
  points: number;
  description: string;
  kind: 'same-color-run' | 'mixed-run' | 'set';
};

export type OkeyScoredCombo = OkeyCombo & {
  playedAt: string;
};

export type OkeySessionEvent = {
  kind: 'initial' | 'discard-one' | 'play-combo' | 'manual-sync';
  at: string;
  message: string;
  cards: OkeyCard[];
};

export type OkeySessionState = {
  hand: OkeyCard[];
  discarded: OkeyCard[];
  scored: OkeyScoredCombo[];
  totalScore: number;
  history: OkeySessionStateSnapshot[];
  events: OkeySessionEvent[];
};

export type OkeySessionStateSnapshot = Omit<OkeySessionState, 'history'>;

export type OkeyDetectedCard = {
  slot: number;
  card: OkeyCard | null;
  confidence: number;
  reason: string;
  signature: OkeyCardSignature | null;
  alternatives: OkeyDetectionAlternative[];
};

export type OkeyDetectionAlternative = {
  card: OkeyCard;
  confidence: number;
  distance: number;
  inkDistance: number;
  visualDistance: number;
};

export type OkeyCardSignature = {
  color: OkeyColor | null;
  hue: number;
  saturation: number;
  lightness: number;
  darkRatio: number;
  topDarkRatio: number;
  centerDarkRatio: number;
  hash: number[];
  numberHash: number[];
  visualHash: number[];
  inkHash: number[];
};

export type OkeyCardTemplate = {
  card: OkeyCard;
  signature: OkeyCardSignature;
};

export const ALL_OKEY_CARDS: OkeyCard[] = OKEY_COLORS.flatMap((color) =>
  OKEY_NUMBERS.map((number) => ({ color, number })),
);

export function okeyCardId(card: OkeyCard): string {
  return `${card.color}-${card.number}`;
}

export function okeyCardLabel(card: OkeyCard): string {
  const prefix: Record<OkeyColor, string> = {
    yellow: 'Y',
    red: 'R',
    blue: 'B',
  };

  return `${prefix[card.color]}${card.number}`;
}

export function parseOkeyCardId(value: string): OkeyCard | null {
  const [color, numberRaw] = value.split('-');
  const number = Number(numberRaw);

  if (!isOkeyColor(color) || !isOkeyNumber(number)) {
    return null;
  }

  return { color, number };
}

export function isOkeyColor(value: string): value is OkeyColor {
  return (OKEY_COLORS as readonly string[]).includes(value);
}

export function isOkeyNumber(value: number): value is OkeyNumber {
  return (OKEY_NUMBERS as readonly number[]).includes(value);
}

export function sameOkeyCard(a: OkeyCard, b: OkeyCard): boolean {
  return a.color === b.color && a.number === b.number;
}

export function uniqueOkeyCards(cards: OkeyCard[]): boolean {
  return new Set(cards.map(okeyCardId)).size === cards.length;
}
