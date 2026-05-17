import {
  OkeyCard,
  OkeyDetectionAlternative,
  OkeyCardSignature,
  OkeyCardTemplate,
  OkeyColor,
  OkeyDetectedCard,
  OKEY_HAND_SIZE,
  OKEY_NUMBERS,
} from './okey-types';

export type OkeyRoi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OkeySlotRect = OkeyRoi & {
  slot: number;
};

export function splitOkeyRoi(roi: OkeyRoi): OkeySlotRect[] {
  const slotWidth = roi.width / OKEY_HAND_SIZE;

  return Array.from({ length: OKEY_HAND_SIZE }, (_, slot) => ({
    slot,
    x: roi.x + slot * slotWidth,
    y: roi.y,
    width: slotWidth,
    height: roi.height,
  }));
}

export function detectOkeyCard(image: ImageData, slot: number, templates: OkeyCardTemplate[]): OkeyDetectedCard {
  const signature = readSignature(image);
  const colorConfidence = colorConfidenceFor(signature);
  const numberMatch = matchSyntheticNumber(signature);
  const templateMatch = matchTemplate(signature, templates, numberMatch);

  if (templateMatch && templateMatch.ambiguous) {
    return {
      slot,
      card: null,
      confidence: templateMatch.confidence,
      reason: `Ambiguous: ${templateMatch.alternatives
        .slice(0, 2)
        .map((alt) => `${cardShortLabel(alt.card)} ${(alt.confidence * 100).toFixed(0)}%`)
        .join(' vs ')}`,
      signature,
      alternatives: templateMatch.alternatives,
    };
  }

  if (templateMatch && templateMatch.confidence >= 0.05) {
    return {
      slot,
      card: templateMatch.card,
      confidence: templateMatch.confidence,
      reason: 'Matched calibrated visual template.',
      signature,
      alternatives: templateMatch.alternatives,
    };
  }

  if (signature.color && colorConfidence >= 0.22 && numberMatch.confidence >= 0.22) {
    const confidence = Math.min(0.92, colorConfidence * 0.48 + numberMatch.confidence * 0.52);

    return {
      slot,
      card: { color: signature.color, number: numberMatch.number },
      confidence,
      reason: 'Detected colour and number from the selected card area.',
      signature,
      alternatives: templateMatch?.alternatives ?? [],
    };
  }

  if (signature.color && colorConfidence >= 0.22) {
    return {
      slot,
      card: null,
      confidence: colorConfidence * 0.55,
      reason: `Detected ${signature.color}, number uncertain.`,
      signature,
      alternatives: templateMatch?.alternatives ?? [],
    };
  }

  return {
    slot,
    card: null,
    confidence: 0,
    reason: 'Card could not be detected confidently.',
    signature,
    alternatives: templateMatch?.alternatives ?? [],
  };
}

export function templatesFromConfirmed(cards: OkeyCard[], images: ImageData[]): OkeyCardTemplate[] {
  return cards.flatMap((card, index) => {
    const image = images[index];

    return image ? [{ card, signature: readSignature(image) }] : [];
  });
}

function readSignature(image: ImageData): OkeyCardSignature {
  const visualSource = cropLikelyCard(centerCrop(image, 0.76, 0.96));
  const { data, width, height } = visualSource;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  let dark = 0;
  let topDark = 0;
  let topCount = 0;
  let centerDark = 0;
  let centerCount = 0;
  let saturatedHueX = 0;
  let saturatedHueY = 0;
  let saturated = 0;
  let redVotes = 0;
  let yellowVotes = 0;
  let blueVotes = 0;
  const buckets = Array.from({ length: 16 }, () => 0);
  const numberBuckets = Array.from({ length: 80 }, () => 0);
  const numberCounts = Array.from({ length: 80 }, () => 0);

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const lightness = (r + g + b) / 3;
      const [pixelHue, pixelSaturation, pixelLightness] = rgbToHsl(r, g, b);

      red += r;
      green += g;
      blue += b;
      count += 1;

      if (lightness < 92) {
        dark += 1;
        buckets[Math.min(15, Math.floor((x / width) * 16))] += 1;
      }

      if (y < height * 0.38) {
        topCount += 1;
        topDark += lightness < 105 ? 1 : 0;
      }

      if (x > width * 0.2 && x < width * 0.8 && y > height * 0.2 && y < height * 0.82) {
        centerCount += 1;
        centerDark += lightness < 105 ? 1 : 0;
      }

      if (x > width * 0.18 && x < width * 0.82 && y > height * 0.12 && y < height * 0.88) {
        const gx = Math.min(7, Math.floor(((x - width * 0.18) / (width * 0.64)) * 8));
        const gy = Math.min(9, Math.floor(((y - height * 0.12) / (height * 0.76)) * 10));
        const bucket = gy * 8 + gx;
        numberCounts[bucket] += 1;
        numberBuckets[bucket] += lightness < 118 ? 1 : 0;
      }

      const inColorBand = x > width * 0.16 && x < width * 0.84 && y > height * 0.12 && y < height * 0.88;

      if (inColorBand && pixelSaturation > 0.24 && pixelLightness > 0.14 && pixelLightness < 0.82) {
        const radians = (pixelHue * Math.PI) / 180;
        saturatedHueX += Math.cos(radians);
        saturatedHueY += Math.sin(radians);
        saturated += 1;

        if ((pixelHue <= 28 || pixelHue >= 342) && r > g * 1.12 && r > b * 1.2) {
          redVotes += 1;
        } else if (pixelHue >= 36 && pixelHue <= 72 && r > 120 && g > 95 && b < 130) {
          yellowVotes += 1;
        } else if (pixelHue >= 175 && pixelHue <= 255 && b > r * 1.12 && b > g * 1.02) {
          blueVotes += 1;
        }
      }
    }
  }

  const [hue, saturation, lightness] = rgbToHsl(red / count, green / count, blue / count);
  const dominantHue =
    saturated > 0 ? (Math.atan2(saturatedHueY / saturated, saturatedHueX / saturated) * 180) / Math.PI : hue;
  const normalizedDominantHue = dominantHue < 0 ? dominantHue + 360 : dominantHue;
  const effectiveSaturation = Math.max(saturation, Math.min(1, saturated / Math.max(1, count)) * 2.4);
  const votedColor = votedOkeyColor(redVotes, yellowVotes, blueVotes);

  return {
    color: votedColor ?? estimateColor(normalizedDominantHue, effectiveSaturation),
    hue: normalizedDominantHue,
    saturation: effectiveSaturation,
    lightness,
    darkRatio: count ? dark / count : 0,
    topDarkRatio: topCount ? topDark / topCount : 0,
    centerDarkRatio: centerCount ? centerDark / centerCount : 0,
    hash: buckets.map((bucket) => bucket / Math.max(1, height / 2)),
    numberHash: numberBuckets.map((bucket, index) => bucket / Math.max(1, numberCounts[index])),
    visualHash: visualHash(visualSource),
    inkHash: inkHash(visualSource),
  };
}

function votedOkeyColor(red: number, yellow: number, blue: number): OkeyColor | null {
  const votes = [
    { color: 'red' as const, value: red },
    { color: 'yellow' as const, value: yellow },
    { color: 'blue' as const, value: blue },
  ].sort((a, b) => b.value - a.value);

  if (votes[0].value < 8 || votes[0].value < votes[1].value * 1.18) {
    return null;
  }

  return votes[0].color;
}

function matchTemplate(
  signature: OkeyCardSignature,
  templates: OkeyCardTemplate[],
  numberGuide: { number: OkeyCard['number']; confidence: number },
): { card: OkeyCard; confidence: number; alternatives: OkeyDetectionAlternative[]; ambiguous: boolean } | null {
  const alternatives = templates.map((template) => {
    const ink = bestShiftedHashDistance(signature.inkHash, template.signature.inkHash ?? [], 16, 20, 2);
    const number = hashDistance(signature.numberHash, template.signature.numberHash ?? []);
    const visual = hashDistance(signature.visualHash, template.signature.visualHash ?? []);
    const colorPenalty = signature.color && template.card.color !== signature.color ? 2.8 : 0;
    const guidedNumberPenalty =
      numberGuide.confidence > 0.16 ? Math.abs(template.card.number - numberGuide.number) * 0.075 : 0;
    const guidedNumberBonus = numberGuide.confidence > 0.16 && template.card.number === numberGuide.number ? 0.11 : 0;
    const distance = ink * 3.4 + number * 0.35 + visual * 0.2 + colorPenalty + guidedNumberPenalty - guidedNumberBonus;
    const confidence = Math.max(0, 1 - distance / 1.55);

    return {
      card: template.card,
      confidence,
      distance,
      inkDistance: ink,
      visualDistance: visual,
    };
  }).sort((a, b) => b.confidence - a.confidence);

  const best = alternatives[0];
  const second = alternatives[1];

  if (!best) {
    return null;
  }

  const ambiguous =
    second != null &&
    best.card.color === second.card.color &&
    best.confidence < 0.4 &&
    best.confidence - second.confidence <= 0.055;

  return {
    card: best.card,
    confidence: best.confidence,
    alternatives: alternatives.slice(0, 24),
    ambiguous,
  };
}

function cardShortLabel(card: OkeyCard): string {
  const prefix: Record<OkeyColor, string> = {
    yellow: 'Y',
    red: 'R',
    blue: 'B',
  };

  return `${prefix[card.color]}${card.number}`;
}

function centerCrop(image: ImageData, widthRatio: number, heightRatio: number): ImageData {
  const width = Math.max(1, Math.round(image.width * widthRatio));
  const height = Math.max(1, Math.round(image.height * heightRatio));
  const x = Math.max(0, Math.round((image.width - width) / 2));
  const y = Math.max(0, Math.round((image.height - height) / 2));

  return copyImageData(image, x, y, width, height);
}

function inkHash(image: ImageData): number[] {
  const gridWidth = 16;
  const gridHeight = 20;
  const out: number[] = [];

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const sx0 = Math.floor(((0.2 + (gx / gridWidth) * 0.6) * image.width));
      const sx1 = Math.max(sx0 + 1, Math.floor((0.2 + ((gx + 1) / gridWidth) * 0.6) * image.width));
      const sy0 = Math.floor(((0.12 + (gy / gridHeight) * 0.76) * image.height));
      const sy1 = Math.max(sy0 + 1, Math.floor((0.12 + ((gy + 1) / gridHeight) * 0.76) * image.height));
      let ink = 0;
      let count = 0;

      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const index = (Math.min(image.height - 1, y) * image.width + Math.min(image.width - 1, x)) * 4;
          const r = image.data[index];
          const g = image.data[index + 1];
          const b = image.data[index + 2];
          const [, saturation, lightness] = rgbToHsl(r, g, b);
          const darkInk = lightness < 0.38 ? 1 : 0;
          const brightInk = lightness > 0.78 && saturation < 0.35 ? 0.65 : 0;
          ink += Math.max(darkInk, brightInk);
          count += 1;
        }
      }

      out.push(ink / Math.max(1, count));
    }
  }

  return out;
}

function bestShiftedHashDistance(a: number[], b: number[], width: number, height: number, maxShift: number): number {
  if (!a.length || !b.length || a.length !== b.length) {
    return 1;
  }

  let best = Number.POSITIVE_INFINITY;

  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let sum = 0;
      let count = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tx = x + dx;
          const ty = y + dy;

          if (tx < 0 || tx >= width || ty < 0 || ty >= height) {
            continue;
          }

          sum += Math.abs(a[y * width + x] - b[ty * width + tx]);
          count += 1;
        }
      }

      if (count) {
        best = Math.min(best, sum / count);
      }
    }
  }

  return best === Number.POSITIVE_INFINITY ? 1 : best;
}

function cropLikelyCard(image: ImageData): ImageData {
  const { data, width, height } = image;
  const cornerSamples: number[][] = [];
  const sampleSize = Math.max(3, Math.floor(Math.min(width, height) * 0.08));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inCorner =
        (x < sampleSize && y < sampleSize) ||
        (x >= width - sampleSize && y < sampleSize) ||
        (x < sampleSize && y >= height - sampleSize) ||
        (x >= width - sampleSize && y >= height - sampleSize);

      if (inCorner) {
        const index = (y * width + x) * 4;
        cornerSamples.push([data[index], data[index + 1], data[index + 2]]);
      }
    }
  }

  const bg = cornerSamples.reduce(
    (sum, pixel) => [sum[0] + pixel[0], sum[1] + pixel[1], sum[2] + pixel[2]],
    [0, 0, 0],
  ).map((value) => value / Math.max(1, cornerSamples.length));
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const [, saturation, lightness] = rgbToHsl(r, g, b);
      const distance = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
      const foreground = distance > 34 || saturation > 0.24 || lightness < 0.22;

      if (!foreground) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      hits += 1;
    }
  }

  const minHits = Math.max(24, (width * height) / 850);

  if (hits < minHits || maxX <= minX || maxY <= minY) {
    return image;
  }

  const padX = Math.max(2, Math.round((maxX - minX) * 0.04));
  const padY = Math.max(2, Math.round((maxY - minY) * 0.04));
  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  const cropWidth = Math.min(width - x, maxX - minX + padX * 2);
  const cropHeight = Math.min(height - y, maxY - minY + padY * 2);

  return copyImageData(image, x, y, Math.max(1, cropWidth), Math.max(1, cropHeight));
}

function visualHash(image: ImageData): number[] {
  const gridWidth = 24;
  const gridHeight = 32;
  const out: number[] = [];

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const sx0 = Math.floor((gx / gridWidth) * image.width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((gx + 1) / gridWidth) * image.width));
      const sy0 = Math.floor((gy / gridHeight) * image.height);
      const sy1 = Math.max(sy0 + 1, Math.floor(((gy + 1) / gridHeight) * image.height));
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;

      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const index = (Math.min(image.height - 1, y) * image.width + Math.min(image.width - 1, x)) * 4;
          red += image.data[index];
          green += image.data[index + 1];
          blue += image.data[index + 2];
          count += 1;
        }
      }

      const r = red / Math.max(1, count);
      const g = green / Math.max(1, count);
      const b = blue / Math.max(1, count);
      const [hue, saturation, lightness] = rgbToHsl(r, g, b);
      out.push(lightness, saturation * 0.75, hue / 360);
    }
  }

  return out;
}

function copyImageData(source: ImageData, startX: number, startY: number, width: number, height: number): ImageData {
  const output = new ImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceIndex = ((startY + y) * source.width + (startX + x)) * 4;
      const targetIndex = (y * width + x) * 4;
      output.data[targetIndex] = source.data[sourceIndex];
      output.data[targetIndex + 1] = source.data[sourceIndex + 1];
      output.data[targetIndex + 2] = source.data[sourceIndex + 2];
      output.data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }

  return output;
}

function matchSyntheticNumber(signature: OkeyCardSignature): { number: OkeyCard['number']; confidence: number } {
  const templates = syntheticNumberTemplates();
  let best = templates[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  templates.forEach((template) => {
    const distance = hashDistance(signature.numberHash, template.hash);

    if (distance < bestDistance) {
      best = template;
      bestDistance = distance;
    }
  });

  return {
    number: best.number,
    confidence: Math.max(0, 1 - bestDistance * 2.8),
  };
}

let cachedSyntheticTemplates: { number: OkeyCard['number']; hash: number[] }[] | null = null;

function syntheticNumberTemplates(): { number: OkeyCard['number']; hash: number[] }[] {
  if (cachedSyntheticTemplates) {
    return cachedSyntheticTemplates;
  }

  if (typeof document === 'undefined') {
    cachedSyntheticTemplates = OKEY_NUMBERS.map((number) => ({
      number,
      hash: Array.from({ length: 80 }, (_, index) => (index % 9 === number % 9 ? 0.35 : 0)),
    }));
    return cachedSyntheticTemplates;
  }

  cachedSyntheticTemplates = OKEY_NUMBERS.map((number) => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 128;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
      return { number, hash: Array.from({ length: 80 }, () => 0) };
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#101010';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '900 88px Arial';
    context.fillText(String(number), canvas.width / 2, canvas.height / 2 + 2);

    return {
      number,
      hash: readSignature(context.getImageData(0, 0, canvas.width, canvas.height)).numberHash,
    };
  });

  return cachedSyntheticTemplates;
}

function estimateColor(hue: number, saturation: number): OkeyColor | null {
  if (saturation < 0.14) {
    return null;
  }

  if (hue <= 24 || hue >= 340) {
    return 'red';
  }

  if (hue >= 36 && hue <= 72) {
    return 'yellow';
  }

  if (hue >= 185 && hue <= 250) {
    return 'blue';
  }

  return null;
}

function colorConfidenceFor(signature: OkeyCardSignature): number {
  if (!signature.color) {
    return 0;
  }

  const targetHue: Record<OkeyColor, number> = {
    red: signature.hue > 180 ? 360 : 0,
    yellow: 54,
    blue: 215,
  };
  const distance = Math.abs(signature.hue - targetHue[signature.color]);
  const hueScore = Math.max(0, 1 - distance / 42);
  const saturationScore = Math.min(1, signature.saturation / 0.42);

  return hueScore * 0.65 + saturationScore * 0.35;
}

function hashDistance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;

  for (let index = 0; index < length; index++) {
    sum += Math.abs(a[index] - b[index]);
  }

  return length ? sum / length : 1;
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return [0, 0, lightness];
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return [hue * 60, saturation, lightness];
}
