import { Injectable } from '@angular/core';
import { AlarmPreset } from './timer.model';

type AlarmTone = {
  frequency: number;
  start: number;
  duration: number;
  type?: OscillatorType;
};

const ALARM_PATTERNS: Record<AlarmPreset, AlarmTone[]> = {
  classic: [
    { frequency: 880, start: 0, duration: 0.22 },
    { frequency: 660, start: 0.28, duration: 0.22 },
    { frequency: 880, start: 0.56, duration: 0.28 },
  ],
  pulse: [
    { frequency: 740, start: 0, duration: 0.12, type: 'square' },
    { frequency: 740, start: 0.18, duration: 0.12, type: 'square' },
    { frequency: 740, start: 0.36, duration: 0.12, type: 'square' },
    { frequency: 980, start: 0.58, duration: 0.22, type: 'square' },
  ],
  chime: [
    { frequency: 523, start: 0, duration: 0.18 },
    { frequency: 659, start: 0.2, duration: 0.18 },
    { frequency: 784, start: 0.42, duration: 0.34 },
  ],
  double: [
    { frequency: 920, start: 0, duration: 0.18 },
    { frequency: 920, start: 0.24, duration: 0.18 },
    { frequency: 620, start: 0.58, duration: 0.24 },
    { frequency: 920, start: 0.88, duration: 0.24 },
  ],
  urgent: [
    { frequency: 990, start: 0, duration: 0.1, type: 'sawtooth' },
    { frequency: 760, start: 0.14, duration: 0.1, type: 'sawtooth' },
    { frequency: 990, start: 0.28, duration: 0.1, type: 'sawtooth' },
    { frequency: 760, start: 0.42, duration: 0.1, type: 'sawtooth' },
    { frequency: 1120, start: 0.6, duration: 0.22, type: 'sawtooth' },
  ],
  soft: [
    { frequency: 440, start: 0, duration: 0.24, type: 'triangle' },
    { frequency: 554, start: 0.3, duration: 0.24, type: 'triangle' },
    { frequency: 659, start: 0.6, duration: 0.34, type: 'triangle' },
  ],
  arcade: [
    { frequency: 659, start: 0, duration: 0.1, type: 'square' },
    { frequency: 784, start: 0.12, duration: 0.1, type: 'square' },
    { frequency: 988, start: 0.24, duration: 0.1, type: 'square' },
    { frequency: 1318, start: 0.38, duration: 0.2, type: 'square' },
  ],
  bell: [
    { frequency: 784, start: 0, duration: 0.42 },
    { frequency: 1175, start: 0.04, duration: 0.34 },
    { frequency: 1568, start: 0.08, duration: 0.24 },
  ],
  rise: [
    { frequency: 520, start: 0, duration: 0.16 },
    { frequency: 650, start: 0.18, duration: 0.16 },
    { frequency: 820, start: 0.36, duration: 0.16 },
    { frequency: 1040, start: 0.56, duration: 0.26 },
  ],
  beacon: [
    { frequency: 620, start: 0, duration: 0.18, type: 'triangle' },
    { frequency: 1040, start: 0.24, duration: 0.18, type: 'triangle' },
    { frequency: 620, start: 0.55, duration: 0.18, type: 'triangle' },
    { frequency: 1040, start: 0.79, duration: 0.3, type: 'triangle' },
  ],
  ios: [
    { frequency: 932, start: 0, duration: 0.16, type: 'triangle' },
    { frequency: 1244, start: 0.17, duration: 0.16, type: 'triangle' },
    { frequency: 932, start: 0.34, duration: 0.16, type: 'triangle' },
    { frequency: 1397, start: 0.54, duration: 0.18, type: 'triangle' },
    { frequency: 1175, start: 0.78, duration: 0.16, type: 'triangle' },
    { frequency: 1397, start: 0.96, duration: 0.28, type: 'triangle' },
  ],
};

@Injectable({ providedIn: 'root' })
export class AlarmService {
  private audioContext: AudioContext | null = null;
  private unlocked = false;

  async unlock(): Promise<void> {
    const context = this.getAudioContext();

    if (!context) {
      return;
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    this.unlocked = true;
  }

  async play(volume = 0.6, preset: AlarmPreset = 'classic'): Promise<void> {
    const context = this.getAudioContext();

    if (!context || !this.unlocked) {
      return;
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    const safeVolume = Math.max(0, Math.min(2, volume));
    const pattern = ALARM_PATTERNS[preset] ?? ALARM_PATTERNS.classic;

    for (const tone of pattern) {
      this.playTone(context, now + tone.start, tone.frequency, tone.duration, safeVolume, tone.type ?? 'sine');
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextCtor) {
      return null;
    }

    this.audioContext ??= new AudioContextCtor();

    return this.audioContext;
  }

  private playTone(
    context: AudioContext,
    start: number,
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.34 * volume), start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
}
