import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  signal,
  viewChild,
} from '@angular/core';
import {
  ALL_OKEY_CARDS,
  OkeyCard,
  OkeyCardTemplate,
  OkeyDetectionAlternative,
  OkeyDetectedCard,
  OkeySessionState,
  okeyCardId,
  okeyCardLabel,
  parseOkeyCardId,
  uniqueOkeyCards,
} from './okey-types';
import { OkeyRoi, detectOkeyCard, splitOkeyRoi, templatesFromConfirmed } from './okey-detection';
import {
  applyObservedOkeyHand,
  confirmInitialOkeyHand,
  createOkeySession,
  syncOkeyHand,
  undoOkeySession,
} from './okey-session';
import { solveOkey } from './okey-solver';

type OkeyCaptureState = 'idle' | 'capturing' | 'awaiting-initial' | 'tracking' | 'paused';
type RoiDragMode = 'draw' | 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se';

const ROI_KEY = 'serpent-okey-card-roi';
const STABLE_FRAMES_REQUIRED = 3;
const FRAME_INTERVAL_MS = 100;
const CONFIDENCE_THRESHOLD = 0.16;
const BACKGROUND_MATCH_THRESHOLD = 0.16;
const BACKGROUND_FRAMES_REQUIRED = 2;
const NEW_CARD_FRAMES_REQUIRED = 2;

@Component({
  selector: 'app-okey-card',
  templateUrl: './okey-card.component.html',
  styleUrl: './okey-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OkeyCardComponent {
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('captureVideo');
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('captureCanvas');
  private stream: MediaStream | null = null;
  private frameHandle = 0;
  private lastFrameAt = 0;
  private stableKey = '';
  private stableFrames = 0;
  private lastAcceptedKey = '';
  private latestSlotImages: ImageData[] = [];
  private acceptedSlotImages: (ImageData | null)[] = [null, null, null, null, null];
  private backgroundImage: ImageData | null = null;
  private slotBackgroundFrames = [0, 0, 0, 0, 0];
  private slotNewCardFrames = [0, 0, 0, 0, 0];
  private slotWaitingForNew = new Set<number>();
  private slotReadyLogged = new Set<number>();
  private lastResolveDebugKey = '';
  private roiDrag:
    | {
        mode: RoiDragMode;
        startPoint: { x: number; y: number };
        startRoi: OkeyRoi | null;
      }
    | null = null;

  protected readonly cards = ALL_OKEY_CARDS;
  protected readonly captureState = signal<OkeyCaptureState>('idle');
  protected readonly captureMessage = signal('Start capture, select the 5-card hand area, then confirm the first read.');
  protected readonly selectingRoi = signal(false);
  protected readonly roi = signal<OkeyRoi | null>(this.readRoi());
  protected readonly draftRoi = signal<OkeyRoi | null>(null);
  protected readonly detections = signal<OkeyDetectedCard[]>([]);
  protected readonly slotPreviewUrls = signal<string[]>([]);
  protected readonly changedSlots = signal<Set<number>>(new Set());
  protected readonly transitionSlots = signal<Set<number>>(new Set());
  protected readonly backgroundSlots = signal<Set<number>>(new Set());
  protected readonly pendingCards = signal<(OkeyCard | null)[]>([null, null, null, null, null]);
  protected readonly manualSlots = signal<Set<number>>(new Set());
  protected readonly templates = signal<OkeyCardTemplate[]>(this.readTemplates());
  protected readonly session = signal<OkeySessionState>(this.readSession());
  protected readonly confirmedSolver = computed(() => solveOkey(this.session()));
  protected readonly analysisSession = computed(() => {
    const pending = this.completePendingHand();

    if (!pending || this.session().hand.length !== 5) {
      return this.session();
    }

    return {
      ...this.session(),
      hand: pending,
    };
  });
  protected readonly solver = computed(() => solveOkey(this.analysisSession()));
  protected readonly usingPendingRecommendation = computed(() => {
    const pending = this.completePendingHand();

    return pending != null && this.session().hand.length === 5 && this.cardsKey(pending) !== this.cardsKey(this.session().hand);
  });
  protected readonly roiLabel = computed(() => {
    const roi = this.roi();

    return roi ? `${Math.round(roi.width)} x ${Math.round(roi.height)} px` : 'No card area selected';
  });
  protected readonly handSlots = computed(() =>
    Array.from({ length: 5 }, (_, index) => ({
      index,
      card: this.session().hand[index] ?? null,
      pending: this.pendingCards()[index] ?? null,
      detection: this.detections()[index] ?? null,
      previewUrl: this.slotPreviewUrls()[index] ?? '',
      manual: this.manualSlots().has(index),
      changed: this.changedSlots().has(index),
      transitioning: this.transitionSlots().has(index),
      background: this.backgroundSlots().has(index),
    })),
  );
  protected readonly canConfirmPending = computed(() => {
    const cards = this.pendingCards().filter((card): card is OkeyCard => card != null);

    return cards.length === 5 && uniqueOkeyCards(cards);
  });
  protected readonly deckSummary = computed(() => {
    const remaining = new Set(this.solver().remainingDeck.map(okeyCardId));
    const activeHand = this.analysisSession().hand;

    return ALL_OKEY_CARDS.map((card) => ({
      card,
      remaining: remaining.has(okeyCardId(card)),
      inHand: activeHand.some((handCard) => okeyCardId(handCard) === okeyCardId(card)),
    }));
  });
  protected readonly remainingCardIds = computed(() => {
    const session = this.session();
    const remaining = this.confirmedSolver().remainingDeck;

    return new Set(remaining.map(okeyCardId));
  });

  constructor() {
    afterNextRender(() => {
      this.clearLegacyStoredState();
      void this.loadAssetTemplates();
      void this.loadBackgroundTemplate();
    });
  }

  protected async startCapture(): Promise<void> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.captureState.set('paused');
      this.captureMessage.set('Screen capture is not available in this browser.');
      return;
    }

    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 10 },
      audio: false,
    });

    const video = this.videoRef()?.nativeElement;

    if (!video) {
      return;
    }

    video.srcObject = this.stream;
    await video.play();
    const hasRoi = this.roi() != null;
    this.selectingRoi.set(!hasRoi);
    this.captureState.set(this.session().hand.length === 5 && hasRoi ? 'tracking' : 'capturing');
    this.captureMessage.set(
      hasRoi
        ? 'Watching selected hand area. Use Select card area if the saved area is wrong.'
        : 'Now drag a rectangle over the 5 visible cards in the preview.',
    );
    this.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopCapture());
    this.drawLoop(0);
  }

  protected stopCapture(): void {
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
    }

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.frameHandle = 0;
    this.captureState.set('idle');
    this.captureMessage.set('Capture stopped.');
  }

  protected resetOkey(): void {
    this.session.set(createOkeySession());
    this.pendingCards.set([null, null, null, null, null]);
    this.manualSlots.set(new Set());
    this.detections.set([]);
    this.slotPreviewUrls.set([]);
    this.selectingRoi.set(this.stream != null);
    this.lastAcceptedKey = '';
    this.acceptedSlotImages = [null, null, null, null, null];
    this.changedSlots.set(new Set());
    this.clearSlotTransitionState();
    this.captureState.set(this.stream ? 'capturing' : 'idle');
    this.captureMessage.set('Session reset. Confirm a fresh initial hand.');
  }

  protected reselectRoi(): void {
    this.roi.set(null);
    this.draftRoi.set(null);
    this.stableKey = '';
    this.stableFrames = 0;
    this.clearSlotTransitionState();
    this.selectingRoi.set(this.stream != null);
    localStorage.removeItem(ROI_KEY);
    this.captureState.set(this.stream ? 'capturing' : 'idle');
    this.captureMessage.set(
      this.stream
        ? 'Selection mode active: drag exactly over the 5 visible cards in the preview.'
        : 'Start capture first, then drag exactly over the 5 visible cards.',
    );
  }

  protected undoOkey(): void {
    this.session.update((state) => undoOkeySession(state));
    this.saveSession();
  }

  protected confirmInitial(): void {
    const cards = this.pendingCards().filter((card): card is OkeyCard => card != null);

    if (cards.length !== 5 || !uniqueOkeyCards(cards)) {
      this.captureMessage.set('Confirm needs 5 unique cards.');
      return;
    }

    this.session.set(confirmInitialOkeyHand(cards));
    this.learnCurrentTemplates(cards);
    this.pendingCards.set(cards);
    this.manualSlots.set(new Set());
    this.acceptedSlotImages = this.cloneLatestSlotImages();
    this.lastAcceptedKey = this.cardsKey(cards);
    this.clearSlotTransitionState();
    this.captureState.set(this.stream ? 'tracking' : 'idle');
    this.captureMessage.set('Initial hand confirmed. Tracking changes automatically.');
    this.saveSession();
    this.debugSession('confirm-initial', this.session());
  }

  protected resumeWithPending(): void {
    const cards = this.pendingCards().filter((card): card is OkeyCard => card != null);

    if (cards.length !== 5 || !uniqueOkeyCards(cards)) {
      this.captureMessage.set('Resolve all 5 slots with unique cards before resuming.');
      return;
    }

    const before = this.session();
    const result = applyObservedOkeyHand(before, cards);
    let nextState = result.state;

    if (result.inference.kind === 'ambiguous') {
      nextState = syncOkeyHand(before, cards, 'Confirmed current hand after ambiguous capture.');
      this.session.set(nextState);
      this.captureMessage.set('Synced the confirmed hand and resumed tracking.');
    } else {
      this.session.set(nextState);
      this.captureMessage.set(result.inference.message);
    }

    this.learnCurrentTemplates(cards);
    this.pendingCards.set(cards);
    this.manualSlots.set(new Set());
    this.acceptedSlotImages = this.cloneLatestSlotImages();
    this.lastAcceptedKey = this.cardsKey(cards);
    this.clearSlotTransitionState();
    this.captureState.set(this.stream ? 'tracking' : 'idle');
    this.saveSession();
    console.debug('[Okey session] manual-confirm', {
      confirmed: this.cardLabels(cards),
      inference: result.inference,
      before: this.sessionDebugPayload(before),
      after: this.sessionDebugPayload(nextState),
    });
  }

  protected setPendingCard(index: number, value: string): void {
    const card = parseOkeyCardId(value);

    this.pendingCards.update((cards) => cards.map((current, slot) => (slot === index ? card : current)));
    this.manualSlots.update((slots) => {
      const next = new Set(slots);

      next.add(index);

      return next;
    });
    this.captureState.set(this.session().hand.length === 5 ? 'paused' : 'awaiting-initial');
    this.captureMessage.set('Manual correction locked for this slot. Confirm to resume automatic tracking.');
  }

  protected cardLabel(card: OkeyCard | null): string {
    return card ? okeyCardLabel(card) : '-';
  }

  protected cardsLabel(cards: OkeyCard[]): string {
    return cards.map(okeyCardLabel).join(' + ');
  }

  protected cardsNeedLabel(cards: OkeyCard[]): string {
    return cards.map(okeyCardLabel).join(', ');
  }

  protected cardId(card: OkeyCard): string {
    return okeyCardId(card);
  }

  protected onPointerDown(event: PointerEvent): void {
    if (!this.stream) {
      return;
    }

    event.preventDefault();

    const point = this.canvasPoint(event, false);

    if (!point) {
      return;
    }

    const currentRoi = this.roi();
    const mode = currentRoi ? this.roiHitMode(point, currentRoi) : 'draw';

    if (!this.selectingRoi() && currentRoi && !mode) {
      return;
    }

    this.roiDrag = {
      mode: mode ?? 'draw',
      startPoint: point,
      startRoi: currentRoi,
    };
    this.canvasRef()?.nativeElement.setPointerCapture(event.pointerId);
    this.draftRoi.set(currentRoi ?? { x: point.x, y: point.y, width: 0, height: 0 });
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.roiDrag) {
      return;
    }

    event.preventDefault();

    const point = this.canvasPoint(event);

    if (!point) {
      return;
    }

    this.draftRoi.set(this.applyRoiDrag(this.roiDrag, point));
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.roiDrag) {
      return;
    }

    event.preventDefault();

    const point = this.canvasPoint(event);
    const drag = this.roiDrag;
    this.roiDrag = null;
    this.releasePointerCapture(event.pointerId);

    if (!point) {
      this.draftRoi.set(null);
      return;
    }

    const finalRoi = this.clampRoi(this.applyRoiDrag(drag, point));

    if (finalRoi.width > 20 && finalRoi.height > 20) {
      this.roi.set(finalRoi);
      this.selectingRoi.set(false);
      localStorage.setItem(ROI_KEY, JSON.stringify(finalRoi));
      this.stableKey = '';
      this.stableFrames = 0;
      this.captureMessage.set('Card area saved. Waiting for stable card detection.');
    }

    this.draftRoi.set(null);
  }

  protected onPointerCancel(): void {
    this.roiDrag = null;
    this.draftRoi.set(null);
  }

  private drawLoop = (time: number) => {
    this.frameHandle = requestAnimationFrame(this.drawLoop);

    const video = this.videoRef()?.nativeElement;
    const canvas = this.canvasRef()?.nativeElement;

    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    this.drawRoi(context);

    if (time - this.lastFrameAt < FRAME_INTERVAL_MS) {
      return;
    }

    this.lastFrameAt = time;
    this.processFrame(context);
  };

  private processFrame(context: CanvasRenderingContext2D): void {
    const roi = this.roi();

    if (!roi) {
      return;
    }

    const slots = splitOkeyRoi(roi);
    this.latestSlotImages = slots.map((slot) =>
      context.getImageData(Math.round(slot.x), Math.round(slot.y), Math.max(1, Math.round(slot.width)), Math.max(1, Math.round(slot.height))),
    );
    this.slotPreviewUrls.set(this.latestSlotImages.map((image) => imageDataUrl(image)));
    const changedSlots = this.changedSlotIndexes();
    this.changedSlots.set(new Set(changedSlots));
    const changedSlotSet = new Set(changedSlots);
    const shouldDetectAllSlots = this.session().hand.length !== 5;
    const frameDetections = this.latestSlotImages.map((image, slot) => {
      if (shouldDetectAllSlots || changedSlotSet.has(slot)) {
        return detectOkeyCard(image, slot, this.templates());
      }

      if (this.session().hand.length === 5 && !changedSlots.includes(slot)) {
        const card = this.session().hand[slot] ?? null;

        return {
          slot,
          card,
          confidence: card ? 1 : 0,
          reason: card ? 'Unchanged confirmed slot.' : 'No confirmed card for slot.',
          signature: null,
          alternatives: card
            ? [
                {
                  card,
                  confidence: 1,
                  distance: 0,
                  inkDistance: 0,
                  visualDistance: 0,
                },
              ]
            : [],
        };
      }

      return detectOkeyCard(image, slot, this.templates());
    });
    const detections = this.resolveFrameDetections(frameDetections, changedSlotSet);
    const detectionKey = detections.map((detection) => detection.card ? okeyCardId(detection.card) : '?').join('|');

    this.detections.set(detections);

    if (detectionKey !== this.stableKey) {
      this.stableKey = detectionKey;
      this.stableFrames = 1;
      return;
    }

    this.stableFrames += 1;

    if (this.stableFrames < STABLE_FRAMES_REQUIRED || detectionKey === this.lastAcceptedKey) {
      return;
    }

    this.handleStableDetections(detections);
  }

  private async loadAssetTemplates(): Promise<void> {
    const loaded = await Promise.all(
      ALL_OKEY_CARDS.map(async (card) => {
        const imageData = await this.loadAssetImageData(card);

        return imageData ? { card, imageData } : null;
      }),
    );
    const assetCards = loaded.filter((entry): entry is { card: OkeyCard; imageData: ImageData } => entry != null);

    if (!assetCards.length) {
      return;
    }

    const assetTemplates = templatesFromConfirmed(
      assetCards.map((entry) => entry.card),
      assetCards.map((entry) => entry.imageData),
    );
    const merged = new Map(assetTemplates.map((template) => [okeyCardId(template.card), template]));

    this.templates().forEach((template) => merged.set(okeyCardId(template.card), template));
    this.templates.set([...merged.values()]);
    this.captureMessage.set(`Loaded ${assetTemplates.length} card templates from assets. Select the card area to start detection.`);
  }

  private async loadBackgroundTemplate(): Promise<void> {
    this.backgroundImage = await imageDataFromUrl('/assets/okey/background-card.png');

    if (this.backgroundImage) {
      console.debug('[Okey background-trigger] loaded background-card.png', {
        width: this.backgroundImage.width,
        height: this.backgroundImage.height,
      });
    }
  }

  private async loadAssetImageData(card: OkeyCard): Promise<ImageData | null> {
    const prefix: Record<OkeyCard['color'], string> = {
      yellow: 'y',
      red: 'r',
      blue: 'b',
    };
    const urls = [
      `/assets/okey/${prefix[card.color]}${card.number - 1}.png`,
      `/assets/okey/${prefix[card.color]}${card.number}.png`,
      `/assets/okey/${card.color}-${card.number}.png`,
    ];

    for (const url of urls) {
      const imageData = await imageDataFromUrl(url);

      if (imageData) {
        return imageData;
      }
    }

    return null;
  }

  private handleStableDetections(detections: OkeyDetectedCard[]): void {
    const detectedChangedSlots = [...this.changedSlots()];

    if (this.session().hand.length !== 5 || detectedChangedSlots.length) {
      console.debug('[Okey detection]', {
        mode: this.session().hand.length !== 5 ? 'initial' : 'background-triggered',
        changedSlots: detectedChangedSlots.map((slot) => slot + 1),
        cards: detections.map((detection) => ({
          slot: detection.slot + 1,
          card: detection.card ? okeyCardLabel(detection.card) : null,
          confidence: detection.confidence.toFixed(3),
          reason: detection.reason,
          alternatives: detection.alternatives.slice(0, 3).map((alt) => ({
            card: okeyCardLabel(alt.card),
            confidence: alt.confidence.toFixed(3),
          })),
        })),
      });
    }

    const cards = detections.map((detection) => detection.card);
    const complete = cards.every((card): card is OkeyCard => card != null);
    const confident = detections.every((detection) => detection.confidence >= CONFIDENCE_THRESHOLD);

    this.pendingCards.update((current) =>
      detections.map((detection, index) => {
        const changed = detectedChangedSlots.includes(index);

        if (this.manualSlots().has(index)) {
          return current[index];
        }

        if (detection.card && detection.confidence >= CONFIDENCE_THRESHOLD && this.cardAllowedInSlot(detection.card, index, changed)) {
          return detection.card;
        }

        if (changed) {
          return null;
        }

        return this.session().hand.length === 5 ? current[index] : current[index] ?? detection.card;
      }),
    );

    if (this.manualSlots().size) {
      this.captureState.set(this.session().hand.length === 5 ? 'paused' : 'awaiting-initial');
      this.captureMessage.set('Manual correction locked. Confirm correction and resume to restart automatic tracking.');
      return;
    }

    if (!complete || !confident) {
      this.captureState.set(this.session().hand.length === 5 ? 'paused' : 'awaiting-initial');
      this.captureMessage.set(
        this.templates().length
          ? 'Detection is uncertain. Correct the highlighted slots to continue.'
          : 'First run needs manual confirmation: choose the 5 cards below, then confirm once.',
      );
      return;
    }

    const nextHand = cards as OkeyCard[];

    if (this.session().hand.length !== 5) {
      this.captureState.set('awaiting-initial');
      this.captureMessage.set('Stable hand detected. Confirm once to begin automatic tracking.');
      return;
    }

    const result = applyObservedOkeyHand(this.session(), nextHand);

    console.debug('[Okey inference]', {
      detectedHand: this.cardLabels(nextHand),
      previousHand: this.cardLabels(this.session().hand),
      inference: result.inference,
      usedBefore: [...this.usedCardIds()],
      remainingBefore: [...this.remainingCardIds()],
    });

    if (result.inference.kind === 'ambiguous') {
      this.captureState.set('paused');
      this.captureMessage.set(result.inference.message);
      return;
    }

    if (result.inference.kind !== 'no-change') {
      this.session.set(result.state);
      this.saveSession();
      this.acceptedSlotImages = this.cloneLatestSlotImages();
      this.changedSlots.set(new Set());
      this.clearSlotTransitionState();
      this.captureMessage.set(result.inference.message);
      this.debugSession('auto-applied', result.state);
    }

    this.lastAcceptedKey = this.cardsKey(nextHand);
  }

  private learnCurrentTemplates(cards: OkeyCard[]): void {
    const newTemplates = templatesFromConfirmed(cards, this.latestSlotImages);
    const existing = new Map(this.templates().map((template) => [okeyCardId(template.card), template]));

    newTemplates.forEach((template) => existing.set(okeyCardId(template.card), template));
    this.templates.set([...existing.values()]);
  }

  private resolveFrameDetections(detections: OkeyDetectedCard[], changedSlots = new Set<number>()): OkeyDetectedCard[] {
    const remaining = this.remainingCardIds();
    const currentHand = this.session().hand;
    const blocked = this.usedCardIds();
    const candidatesBySlot = detections.map((detection, slot) => {
      const current = currentHand[slot] ?? null;
      const currentId = current ? okeyCardId(current) : null;
      const unchanged = current && currentHand.length === 5 && !changedSlots.has(slot);
      const slotChanged = changedSlots.has(slot);

      if (unchanged) {
        return [
          {
            card: current,
            confidence: 1,
            distance: 0,
            inkDistance: 0,
            visualDistance: 0,
          },
        ];
      }

      const cardsInOtherSlots = new Set(
        currentHand
          .filter((_, index) => index !== slot)
          .map(okeyCardId),
      );
      const candidates = detection.alternatives
        .filter((alternative) => !blocked.has(okeyCardId(alternative.card)))
        .filter((alternative) => !cardsInOtherSlots.has(okeyCardId(alternative.card)))
        .filter((alternative) => remaining.has(okeyCardId(alternative.card)) || (!slotChanged && okeyCardId(alternative.card) === currentId))
        .map((alternative) => ({
          ...alternative,
          confidence:
            !slotChanged && currentId && okeyCardId(alternative.card) === currentId
              ? Math.min(1, alternative.confidence + 0.035)
              : alternative.confidence,
        }));

      if (
        detection.card &&
        !blocked.has(okeyCardId(detection.card)) &&
        !cardsInOtherSlots.has(okeyCardId(detection.card)) &&
        (remaining.has(okeyCardId(detection.card)) || (!slotChanged && okeyCardId(detection.card) === currentId))
      ) {
        const id = okeyCardId(detection.card);

        if (!candidates.some((candidate) => okeyCardId(candidate.card) === id)) {
          candidates.unshift({
            card: detection.card,
            confidence: detection.confidence,
            distance: 1 - detection.confidence,
            inkDistance: 1 - detection.confidence,
            visualDistance: 1 - detection.confidence,
          });
        }
      }

      return candidates.slice(0, 10);
    });
    const assigned = this.bestUniqueAssignment(candidatesBySlot);
    const shouldDebug = changedSlots.size > 0;

    if (shouldDebug) {
      const debugKey = JSON.stringify({
        changed: [...changedSlots],
        cards: detections.map((detection) => detection.card ? okeyCardId(detection.card) : '?'),
        confidence: detections.map((detection) => detection.confidence.toFixed(2)),
      });

      if (debugKey !== this.lastResolveDebugKey) {
        this.lastResolveDebugKey = debugKey;
        console.debug('[Okey resolve]', {
        changedSlots: [...changedSlots].map((slot) => slot + 1),
        transitioningSlots: [...this.transitionSlots()].map((slot) => slot + 1),
        currentHand: this.cardLabels(currentHand),
        used: [...blocked],
        remaining: [...remaining],
        slots: detections.map((detection, slot) => ({
          slot: slot + 1,
          current: currentHand[slot] ? okeyCardLabel(currentHand[slot]) : null,
          rawCard: detection.card ? okeyCardLabel(detection.card) : null,
          rawConfidence: detection.confidence.toFixed(3),
          rawAlternatives: detection.alternatives.slice(0, 6).map((alt) => ({
            card: okeyCardLabel(alt.card),
            id: okeyCardId(alt.card),
            confidence: alt.confidence.toFixed(3),
          })),
          filteredAlternatives: candidatesBySlot[slot].slice(0, 6).map((alt) => ({
            card: okeyCardLabel(alt.card),
            id: okeyCardId(alt.card),
            confidence: alt.confidence.toFixed(3),
          })),
          assigned: assigned[slot]?.card ? okeyCardLabel(assigned[slot].card) : null,
        })),
        });
      }
    }

    return detections.map((detection, slot) => {
      const alternatives = candidatesBySlot[slot].sort((a, b) => b.confidence - a.confidence);
      const best = assigned[slot] ?? alternatives[0] ?? null;

      if (!best) {
        return {
          ...detection,
          card: null,
          confidence: 0,
          reason: `${detection.reason} / no possible unused card`,
          alternatives,
        };
      }

      const originalTop = detection.alternatives[0];
      const filtered = originalTop && okeyCardId(originalTop.card) !== okeyCardId(best.card);

      return {
        ...detection,
        card: best.card,
        confidence: best.confidence,
        reason: filtered ? `${detection.reason} / unique-deck assignment` : detection.reason,
        alternatives,
      };
    });
  }

  private usedCardIds(): Set<string> {
    const state = this.session();
    const used = new Set<string>();

    state.discarded.forEach((card) => used.add(okeyCardId(card)));
    state.scored.forEach((combo) => combo.cards.forEach((card) => used.add(okeyCardId(card))));

    return used;
  }

  private cardAllowedInSlot(card: OkeyCard, slot: number, slotChanged: boolean): boolean {
    if (this.session().hand.length !== 5) {
      return true;
    }

    const id = okeyCardId(card);
    const currentHand = this.session().hand;
    const currentId = currentHand[slot] ? okeyCardId(currentHand[slot]) : null;
    const cardsInOtherSlots = new Set(
      currentHand
        .filter((_, index) => index !== slot)
        .map(okeyCardId),
    );

    if (this.usedCardIds().has(id) || cardsInOtherSlots.has(id)) {
      return false;
    }

    return this.remainingCardIds().has(id) || (!slotChanged && id === currentId);
  }

  private debugSession(stage: string, state: OkeySessionState): void {
    console.debug(`[Okey session] ${stage}`, this.sessionDebugPayload(state));
  }

  private sessionDebugPayload(state: OkeySessionState): {
    hand: string[];
    discarded: string[];
    scored: string[][];
    totalScore: number;
    used: string[];
    remaining: string[];
  } {
    const used = new Set<string>();

    state.discarded.forEach((card) => used.add(okeyCardId(card)));
    state.scored.forEach((combo) => combo.cards.forEach((card) => used.add(okeyCardId(card))));

    return {
      hand: this.cardLabels(state.hand),
      discarded: this.cardLabels(state.discarded),
      scored: state.scored.map((combo) => this.cardLabels(combo.cards)),
      totalScore: state.totalScore,
      used: [...used],
      remaining: ALL_OKEY_CARDS.filter((card) => {
        const id = okeyCardId(card);

        return !used.has(id) && !state.hand.some((handCard) => okeyCardId(handCard) === id);
      }).map(okeyCardId),
    };
  }

  private cardLabels(cards: OkeyCard[]): string[] {
    return cards.map(okeyCardLabel);
  }

  private completePendingHand(): OkeyCard[] | null {
    const cards = this.pendingCards();

    if (!cards.every((card): card is OkeyCard => card != null)) {
      return null;
    }

    return uniqueOkeyCards(cards) ? [...cards] : null;
  }

  private changedSlotIndexes(): number[] {
    if (this.session().hand.length !== 5 || this.acceptedSlotImages.some((image) => image == null)) {
      this.backgroundSlots.set(new Set());
      this.transitionSlots.set(new Set());
      return [0, 1, 2, 3, 4];
    }

    const changed: number[] = [];
    const backgroundSlots = new Set<number>();
    const transitionSlots = new Set<number>();
    this.latestSlotImages.forEach((image, index) => {
      const backgroundDistance = this.backgroundImage ? imageDistance(image, this.backgroundImage) : 1;
      const isBackground = this.backgroundImage != null && backgroundDistance <= BACKGROUND_MATCH_THRESHOLD;

      if (isBackground) {
        this.slotBackgroundFrames[index] += 1;
        this.slotNewCardFrames[index] = 0;

        if (this.slotBackgroundFrames[index] >= BACKGROUND_FRAMES_REQUIRED) {
          const wasWaiting = this.slotWaitingForNew.has(index);

          this.slotWaitingForNew.add(index);
          backgroundSlots.add(index);
          transitionSlots.add(index);

          if (!wasWaiting) {
            console.debug('[Okey background]', {
              slot: index + 1,
              state: 'background-seen',
              backgroundDistance: backgroundDistance.toFixed(4),
            });
          }
        }
      } else {
        this.slotBackgroundFrames[index] = 0;

        if (this.slotWaitingForNew.has(index)) {
          this.slotNewCardFrames[index] += 1;
          transitionSlots.add(index);

          if (this.slotNewCardFrames[index] >= NEW_CARD_FRAMES_REQUIRED) {
            changed.push(index);

            if (!this.slotReadyLogged.has(index)) {
              this.slotReadyLogged.add(index);
              console.debug('[Okey background]', {
                slot: index + 1,
                state: 'new-card-ready',
                backgroundDistance: this.backgroundImage ? backgroundDistance.toFixed(4) : 'n/a',
              });
            }
          }
        }
      }
    });

    this.backgroundSlots.set(backgroundSlots);
    this.transitionSlots.set(transitionSlots);

    return changed;
  }

  private cloneLatestSlotImages(): (ImageData | null)[] {
    return this.latestSlotImages.map((image) => cloneImageData(image));
  }

  private clearSlotTransitionState(): void {
    this.slotBackgroundFrames = [0, 0, 0, 0, 0];
    this.slotNewCardFrames = [0, 0, 0, 0, 0];
    this.slotWaitingForNew.clear();
    this.slotReadyLogged.clear();
    this.lastResolveDebugKey = '';
    this.backgroundSlots.set(new Set());
    this.transitionSlots.set(new Set());
  }

  private clearLegacyStoredState(): void {
    localStorage.removeItem('serpent-okey-card-session');
    localStorage.removeItem('serpent-okey-card-templates');
  }

  private bestUniqueAssignment(candidatesBySlot: OkeyDetectionAlternative[][]): (OkeyDetectionAlternative | null)[] {
    let bestScore = Number.NEGATIVE_INFINITY;
    let best: (OkeyDetectionAlternative | null)[] = Array.from({ length: candidatesBySlot.length }, () => null);
    const current: (OkeyDetectionAlternative | null)[] = [];
    const used = new Set<string>();

    const walk = (slot: number, score: number) => {
      if (slot === candidatesBySlot.length) {
        if (score > bestScore) {
          bestScore = score;
          best = [...current];
        }

        return;
      }

      const candidates = candidatesBySlot[slot];

      if (!candidates.length) {
        current.push(null);
        walk(slot + 1, score - 1);
        current.pop();
        return;
      }

      candidates.forEach((candidate) => {
        const id = okeyCardId(candidate.card);

        if (used.has(id)) {
          return;
        }

        used.add(id);
        current.push(candidate);
        walk(slot + 1, score + candidate.confidence);
        current.pop();
        used.delete(id);
      });
    };

    walk(0, 0);

    return best;
  }

  private drawRoi(context: CanvasRenderingContext2D): void {
    const roi = this.draftRoi() ?? this.roi();

    if (!roi) {
      return;
    }

    context.save();
    context.strokeStyle = '#ffe66f';
    context.lineWidth = Math.max(2, context.canvas.width / 900);
    context.strokeRect(roi.x, roi.y, roi.width, roi.height);
    context.fillStyle = '#ffe66f';

    const handle = Math.max(8, context.canvas.width / 130);
    const handles = [
      [roi.x, roi.y],
      [roi.x + roi.width, roi.y],
      [roi.x, roi.y + roi.height],
      [roi.x + roi.width, roi.y + roi.height],
    ];

    handles.forEach(([x, y]) => {
      context.fillRect(x - handle / 2, y - handle / 2, handle, handle);
    });

    splitOkeyRoi(roi).forEach((slot) => {
      context.strokeStyle = 'rgba(255, 230, 111, 0.45)';
      context.strokeRect(slot.x, slot.y, slot.width, slot.height);
    });

    context.restore();
  }

  private canvasPoint(event: PointerEvent, clampToImage = true): { x: number; y: number } | null {
    const canvas = this.canvasRef()?.nativeElement;

    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0 || canvas.width === 0 || canvas.height === 0) {
      return null;
    }

    const imageRect = fittedCanvasImageRect(canvas, rect);
    const localX = event.clientX - imageRect.left;
    const localY = event.clientY - imageRect.top;

    if (!clampToImage && (localX < 0 || localX > imageRect.width || localY < 0 || localY > imageRect.height)) {
      return null;
    }

    const x = clampUnit(localX / imageRect.width) * canvas.width;
    const y = clampUnit(localY / imageRect.height) * canvas.height;

    return { x, y };
  }

  private releasePointerCapture(pointerId: number): void {
    const canvas = this.canvasRef()?.nativeElement;

    if (canvas?.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  }

  private roiHitMode(point: { x: number; y: number }, roi: OkeyRoi): RoiDragMode | null {
    const tolerance = Math.max(12, Math.min(roi.width, roi.height) * 0.08);
    const nearLeft = Math.abs(point.x - roi.x) <= tolerance;
    const nearRight = Math.abs(point.x - (roi.x + roi.width)) <= tolerance;
    const nearTop = Math.abs(point.y - roi.y) <= tolerance;
    const nearBottom = Math.abs(point.y - (roi.y + roi.height)) <= tolerance;
    const inside = point.x >= roi.x && point.x <= roi.x + roi.width && point.y >= roi.y && point.y <= roi.y + roi.height;

    if (nearLeft && nearTop) {
      return 'resize-nw';
    }

    if (nearRight && nearTop) {
      return 'resize-ne';
    }

    if (nearLeft && nearBottom) {
      return 'resize-sw';
    }

    if (nearRight && nearBottom) {
      return 'resize-se';
    }

    return inside ? 'move' : null;
  }

  private applyRoiDrag(
    drag: { mode: RoiDragMode; startPoint: { x: number; y: number }; startRoi: OkeyRoi | null },
    point: { x: number; y: number },
  ): OkeyRoi {
    const dx = point.x - drag.startPoint.x;
    const dy = point.y - drag.startPoint.y;
    const roi = drag.startRoi;

    if (!roi || drag.mode === 'draw') {
      return this.clampRoi(normalizeRoi(drag.startPoint, point));
    }

    if (drag.mode === 'move') {
      return this.clampRoi({ ...roi, x: roi.x + dx, y: roi.y + dy });
    }

    const left = drag.mode === 'resize-nw' || drag.mode === 'resize-sw' ? roi.x + dx : roi.x;
    const right = drag.mode === 'resize-ne' || drag.mode === 'resize-se' ? roi.x + roi.width + dx : roi.x + roi.width;
    const top = drag.mode === 'resize-nw' || drag.mode === 'resize-ne' ? roi.y + dy : roi.y;
    const bottom = drag.mode === 'resize-sw' || drag.mode === 'resize-se' ? roi.y + roi.height + dy : roi.y + roi.height;

    return this.clampRoi(normalizeRoi({ x: left, y: top }, { x: right, y: bottom }));
  }

  private clampRoi(roi: OkeyRoi): OkeyRoi {
    const canvas = this.canvasRef()?.nativeElement;

    if (!canvas) {
      return roi;
    }

    const width = Math.max(1, Math.min(roi.width, canvas.width));
    const height = Math.max(1, Math.min(roi.height, canvas.height));

    return {
      x: Math.min(Math.max(0, roi.x), canvas.width - width),
      y: Math.min(Math.max(0, roi.y), canvas.height - height),
      width,
      height,
    };
  }

  private cardsKey(cards: OkeyCard[]): string {
    return cards.map(okeyCardId).join('|');
  }

  private saveSession(): void {
    // Keep session in memory only. Refresh/rebuild should not resurrect old cards.
  }

  private readSession(): OkeySessionState {
    return createOkeySession();
  }

  private readRoi(): OkeyRoi | null {
    try {
      return JSON.parse(localStorage.getItem(ROI_KEY) ?? 'null') as OkeyRoi | null;
    } catch {
      return null;
    }
  }

  private readTemplates(): OkeyCardTemplate[] {
    return [];
  }
}

function normalizeRoi(start: { x: number; y: number }, end: { x: number; y: number }): OkeyRoi {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function fittedCanvasImageRect(canvas: HTMLCanvasElement, rect: DOMRect): { left: number; top: number; width: number; height: number } {
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;

  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function imageDataUrl(image: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');

  if (!context) {
    return '';
  }

  context.putImageData(image, 0, 0);

  return canvas.toDataURL('image/png');
}

function imageDataFromUrl(url: string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });

      if (!context) {
        resolve(null);
        return;
      }

      context.drawImage(image, 0, 0);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function cloneImageData(image: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}

function imageDistance(a: ImageData, b: ImageData): number {
  const gridWidth = 18;
  const gridHeight = 24;
  let sum = 0;
  let centerSum = 0;
  let centerCount = 0;

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const ax = Math.min(a.width - 1, Math.floor(((gx + 0.5) / gridWidth) * a.width));
      const ay = Math.min(a.height - 1, Math.floor(((gy + 0.5) / gridHeight) * a.height));
      const bx = Math.min(b.width - 1, Math.floor(((gx + 0.5) / gridWidth) * b.width));
      const by = Math.min(b.height - 1, Math.floor(((gy + 0.5) / gridHeight) * b.height));
      const ai = (ay * a.width + ax) * 4;
      const bi = (by * b.width + bx) * 4;
      const ar = a.data[ai] / 255;
      const ag = a.data[ai + 1] / 255;
      const ab = a.data[ai + 2] / 255;
      const br = b.data[bi] / 255;
      const bg = b.data[bi + 1] / 255;
      const bb = b.data[bi + 2] / 255;
      const al = (ar + ag + ab) / 3;
      const bl = (br + bg + bb) / 3;
      const colorDistance = (Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)) / 3;
      const lumaDistance = Math.abs(al - bl);
      const cellDistance = colorDistance * 0.72 + lumaDistance * 0.28;

      sum += cellDistance;

      if (gx >= 5 && gx <= 12 && gy >= 4 && gy <= 19) {
        centerSum += cellDistance * 1.8;
        centerCount += 1;
      }
    }
  }

  const fullDistance = sum / (gridWidth * gridHeight);
  const digitDistance = centerCount ? centerSum / centerCount : fullDistance;

  return fullDistance * 0.45 + digitDistance * 0.55;
}
