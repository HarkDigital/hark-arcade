import type { Frame } from '../core/types'
import type { EngineState } from '../core/Engine'

/*
 * Hark Arcade sound: a tiny chiptune console in WebAudio (no files).
 *
 *   music    four "channels" like an old sound chip: a pulse-wave arpeggio,
 *            a triangle bassline, a soft pulse lead and a noise/triangle kit.
 *            Every level has its own tune (key, tempo, chords, groove):
 *              hero      title theme, bright C major
 *              work      bouncy arcade-hall shuffle
 *              services  sparkling power-up arps
 *              voices    a calm village tune (triangle, no drums)
 *              shield    the boss theme (A minor, driving octave bass)
 *              process   a marching world-map theme
 *              contact   a tender "Continue?" lullaby
 *            A level change waits for the next beat, rests one beat, and
 *            starts the new tune from its first bar.
 *   cut()    the iris "warp": a stepped pitch sweep, like entering a pipe
 *   blip()   the coin "bling" (two quick notes), pitched by `pitch`
 *   pause()  the pause menu: the "pause" jingle, the tune drops to a murmur
 *   sfx()    cursor tick, coin, power-up, jump, hit, warp; chapters can also
 *            fire them with an event (no import needed):
 *              window.dispatchEvent(new CustomEvent('hark:sfx', { detail: { kind: 'coin', level: 0.8 } }))
 *   tone()   a pure sine a chapter may ask for (or via 'hark:tone' events)
 *
 * Off by default. Sound only ever starts from a user gesture: the toggle's
 * own click / tap / Enter / Space. A remembered "on" (localStorage) waits for
 * the first real activation (a pointer press or tap, or Enter / Space on a
 * control; never Tab, Shift or scrolling keys). Faded out and suspended while
 * the tab is hidden. On iOS the session is switched to "playback" so the
 * silent switch does not swallow it. Levels are kept soft: square waves are
 * band-limited, the music bus is low-passed, and a gentle compressor glues it.
 */

export const STORE_KEY = 'hark-arcade:audio'

/** The remembered choice: true (on), false (off), or null when never set. */
export function storedAudio(): boolean | null {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

export type SfxKind = 'coin' | 'cursor' | 'powerup' | 'jump' | 'hit' | 'warp' | 'pause'

/** keys that activate a focused control; everything else (Tab, Shift, arrows, PageDown…) is navigation */
const ACTIVATE_KEYS = new Set(['Enter', ' ', 'Spacebar'])
const CONTROL = 'a[href], button, [role="button"], [role="switch"], summary, input, select, textarea'
const MASTER_LEVEL = 1.4
const TONE_MAX = 0.06
const LOOKAHEAD = 0.25

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/* ------------------------------------------------------------------ songs */

type Drums = 'none' | 'soft' | 'march' | 'boss'
type Wave = 'pulse25' | 'pulse12' | 'pulse50' | 'triangle'

interface Song {
  bpm: number
  /** MIDI root of the key */
  root: number
  /** four chords (semitones from root), one per bar */
  prog: number[][]
  /** arpeggio: 16 steps per bar, index into [c0, c1, c2, c0+12], -1 rest */
  arp: number[]
  arpWave: Wave
  arpLevel: number
  /** bass: 8 eighths per bar, 0 root, 1 fifth, 2 octave, -1 rest */
  bass: number[]
  /** lead: bars of 8 eighths, index into two octaves of chord tones, -1 rest, -2 hold */
  lead?: number[][]
  leadWave?: Wave
  drums: Drums
  /** overall music level for this level (1 = default) */
  level?: number
}

// chords as semitone offsets from the key root
const I = [0, 4, 7]
const ii = [2, 5, 9]
const IV = [5, 9, 12]
const V = [7, 11, 14]
const vi = [9, 12, 16]
const i_ = [0, 3, 7]
const iv_ = [5, 8, 12]
const VI_ = [8, 12, 15]
const VII_ = [10, 14, 17]
const Vh = [7, 11, 14]

const SONGS: Record<string, Song> = {
  hero: {
    bpm: 116,
    root: 60,
    prog: [I, V, vi, IV],
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 1, 2, 1],
    arpWave: 'pulse25',
    arpLevel: 1,
    bass: [0, -1, 1, -1, 2, -1, 1, -1],
    lead: [
      [3, -2, 4, 5, 4, -2, 3, -1],
      [2, -2, 3, 4, 3, -2, -1, -1],
      [3, -2, 2, 1, 2, -2, 0, -1],
      [1, -2, 2, 3, 2, -2, -2, -1],
    ],
    leadWave: 'pulse50',
    drums: 'soft',
  },
  work: {
    bpm: 124,
    root: 62,
    prog: [I, IV, I, V],
    arp: [0, -1, 2, 1, 3, -1, 2, 1, 0, -1, 2, 1, 3, 2, 1, 2],
    arpWave: 'pulse25',
    arpLevel: 0.95,
    bass: [0, 1, 2, 1, 0, 1, 2, 1],
    lead: [
      [-1, -1, 3, 4, 5, -2, 4, 3],
      [-1, -1, 4, -2, 3, -2, 2, -1],
      [-1, -1, 3, 4, 5, -2, 4, 5],
      [4, -2, 3, -2, 2, -2, -1, -1],
    ],
    leadWave: 'pulse50',
    drums: 'soft',
  },
  services: {
    bpm: 128,
    root: 64,
    prog: [I, vi, IV, V],
    arp: [0, 1, 2, 3, 0, 1, 2, 3, 1, 2, 3, 2, 1, 2, 3, 2],
    arpWave: 'pulse12',
    arpLevel: 0.9,
    bass: [0, -1, 0, 2, -1, 0, 1, -1],
    lead: [
      [5, -2, -2, 4, 3, -2, 4, -2],
      [3, -2, -2, -1, 2, 3, 4, -1],
      [5, -2, -2, 4, 3, -2, 2, -2],
      [4, -2, 3, -2, 5, -2, -2, -1],
    ],
    leadWave: 'pulse25',
    drums: 'soft',
  },
  voices: {
    bpm: 92,
    root: 65,
    prog: [I, IV, ii, V],
    arp: [0, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1, 2, -1, -1, -1],
    arpWave: 'triangle',
    arpLevel: 1.2,
    bass: [0, -1, -1, -1, 1, -1, -1, -1],
    lead: [
      [3, -2, 2, 3, 4, -2, -2, -1],
      [3, -2, 2, 1, 2, -2, -2, -1],
      [1, -2, 2, 3, 2, -2, 1, -1],
      [2, -2, -2, 1, 0, -2, -2, -1],
    ],
    leadWave: 'triangle',
    drums: 'none',
    level: 0.95,
  },
  shield: {
    bpm: 144,
    root: 57,
    prog: [i_, VI_, iv_, Vh],
    arp: [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1],
    arpWave: 'pulse25',
    arpLevel: 0.85,
    bass: [0, 2, 0, 2, 0, 2, 1, 2],
    lead: [
      [3, -1, 3, -1, 4, 3, -1, 5],
      [-2, -2, 4, -2, 3, -2, -1, -1],
      [3, -1, 3, -1, 4, 5, -1, 4],
      [-2, -2, 2, -2, 1, -2, -1, -1],
    ],
    leadWave: 'pulse25',
    drums: 'boss',
    level: 0.9,
  },
  process: {
    bpm: 108,
    root: 67,
    prog: [I, IV, vi, V],
    arp: [0, -1, 1, -1, 2, -1, 1, -1, 0, -1, 1, -1, 2, -1, 3, -1],
    arpWave: 'pulse25',
    arpLevel: 1,
    bass: [0, -1, 1, -1, 0, -1, 1, -1],
    lead: [
      [0, -2, 1, 2, 3, -2, 2, -1],
      [1, -2, 2, 3, 4, -2, -2, -1],
      [3, -2, 2, 1, 2, -2, 0, -1],
      [1, -2, -2, 2, 1, -2, -2, -1],
    ],
    leadWave: 'pulse50',
    drums: 'march',
  },
  contact: {
    bpm: 82,
    root: 63,
    prog: [I, vi, IV, V],
    arp: [0, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 2, -1, 1, -1],
    arpWave: 'triangle',
    arpLevel: 1.1,
    bass: [0, -1, -1, -1, 1, -1, -1, -1],
    lead: [
      [4, -2, -2, 3, 2, -2, -2, -1],
      [3, -2, -2, 2, 1, -2, -2, -1],
      [2, -2, -2, 3, 4, -2, -2, -1],
      [3, -2, -2, -2, -1, -1, -1, -1],
    ],
    leadWave: 'pulse50',
    drums: 'none',
    level: 0.85,
  },
}

/* ------------------------------------------------------------------ helpers */

function pulseWave(ctx: AudioContext, duty: number) {
  // band-limited pulse: softer than a naive square, still unmistakably chip
  const N = 40
  const real = new Float32Array(N)
  const imag = new Float32Array(N)
  for (let n = 1; n < N; n++) real[n] = ((2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty)) * Math.pow(0.94, n)
  return ctx.createPeriodicWave(real, imag)
}

function noiseBuffer(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  // a sample-and-hold "LFSR" feel: values held for a few samples like a chip's noise channel
  let v = 0
  for (let i = 0; i < len; i++) {
    if (i % 3 === 0) v = Math.random() * 2 - 1
    d[i] = v
  }
  return buf
}

/**
 * iOS routes Web Audio through the "ambient" session, which the ring/silent
 * switch mutes. Safari 16.4+ lets a page opt into "playback"; hand it back to
 * "auto" when muted. Feature-detected; a no-op elsewhere.
 */
function setAudioSession(type: 'playback' | 'auto') {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session && session.type !== type) session.type = type
  } catch {
    /* unsupported */
  }
}

export class Sound {
  enabled = false
  onChange: ((enabled: boolean) => void)[] = []

  private ctx: AudioContext | null = null
  private master!: GainNode
  private music!: GainNode
  private fx!: GainNode
  private waves!: Record<Exclude<Wave, 'triangle'>, PeriodicWave>
  private noise!: AudioBuffer
  private toneOsc!: OscillatorNode
  private toneGain!: GainNode

  // story state (from update)
  private chapter = 'hero'
  private song: Song = SONGS.hero
  private pending: string | null = null
  private paused = false

  // sequencer (audio clock)
  private schedTimer = 0
  private nextStep = 0
  private step = 0

  private lastCut = 0
  private lastBlip = 0
  private lastCursor = 0
  private suspendTimer = 0
  private hidden = typeof document !== 'undefined' && document.hidden
  /** a remembered "on" preference waiting for the first user gesture */
  private armed = false
  private gestureBound = false

  // requested pure tone (kept even while muted so it applies the moment sound starts)
  private toneHz = 440
  private toneLevel = 0
  private toneSent = { hz: 0, level: -1 }

  constructor() {
    this.armed = storedAudio() === true
    if (this.armed) this.waitForGesture()
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden
      this.applyRunning()
    })
    // an explicit on/off from elsewhere (must itself come from a gesture)
    window.addEventListener('hark:audio', e => {
      const d = (e as CustomEvent<{ on?: boolean }>).detail
      if (d && typeof d.on === 'boolean') this.set(d.on)
    })
    window.addEventListener('hark:tone', e => {
      const d = (e as CustomEvent<{ hz?: number; level?: number }>).detail
      if (d && typeof d.hz === 'number') this.tone(d.hz, d.level ?? 0)
    })
    window.addEventListener('hark:sfx', e => {
      const d = (e as CustomEvent<{ kind?: string; level?: number; pitch?: number }>).detail
      if (!d?.kind) return
      // Town-era names still work: pop = coin, whoosh = warp
      const kind = d.kind === 'pop' ? 'coin' : d.kind === 'whoosh' ? 'warp' : d.kind
      this.sfx(kind as SfxKind, d.level ?? 1, d.pitch ?? 0)
    })
  }

  /** Flip sound on/off. Call from a user gesture (click / key). */
  toggle() {
    this.armed = false
    this.setEnabled(!this.enabled)
    this.persist(this.enabled)
  }

  /** Set sound on/off and remember the choice (even when it is unchanged). */
  set(on: boolean) {
    this.armed = false
    this.setEnabled(on)
    this.persist(on)
  }

  /** Release any requested tone at once (e.g. while the scene is covered). */
  hush() {
    if (this.toneLevel === 0) return
    this.toneLevel = 0
    this.applyTone()
  }

  /** The pause menu: a little jingle, and the tune drops to a murmur until resumed. */
  pause(on: boolean) {
    if (on === this.paused) return
    this.paused = on
    const ctx = this.live()
    if (!ctx) return
    this.sfx('pause', 1, on ? 0 : 4)
    const lv = on ? 0.18 : (this.song.level ?? 1)
    this.music.gain.setTargetAtTime(lv, ctx.currentTime, 0.08)
  }

  /** Follow the story: which level is playing. */
  update(_frame: Frame, state: EngineState) {
    const slot = state.slots[state.index]
    if (!slot) return
    const id = slot.def.id
    if (id !== this.chapter) {
      this.chapter = id
      this.pending = id
    }
  }

  /** The iris warp between levels. */
  cut(from: number, to: number) {
    this.sfx('warp', 1, to >= from ? 0 : -1)
  }

  /** The coin "bling" (nav, buttons). `pitch` moves it up the major scale. No-op while sound is off. */
  blip(pitch = 0) {
    this.sfx('coin', 1, pitch)
  }

  /** A pure sine a chapter may ask for: level 0..1 (0 releases it). */
  tone(hz: number, level: number) {
    if (Number.isFinite(hz) && hz > 20 && hz < 12000) this.toneHz = hz
    this.toneLevel = clamp01(Number.isFinite(level) ? level : 0)
    this.applyTone()
  }

  /** One-shot sound effects. */
  sfx(kind: SfxKind, level = 1, pitch = 0) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    const a = clamp01(level)
    const semis = [0, 2, 4, 5, 7, 9, 11, 12][Math.abs(Math.round(pitch)) % 8]
    switch (kind) {
      case 'coin': {
        if (now - this.lastBlip < 0.06) return
        this.lastBlip = now
        this.voice(ctx, this.fx, now, 83 + semis, 0.065, 0.05 * a, 'pulse50', 0.004)
        this.voice(ctx, this.fx, now + 0.065, 88 + semis, 0.34, 0.05 * a, 'pulse50', 0.3)
        break
      }
      case 'cursor': {
        if (now - this.lastCursor < 0.05) return
        this.lastCursor = now
        this.voice(ctx, this.fx, now, 91 + semis, 0.028, 0.022 * a, 'pulse12', 0.02)
        break
      }
      case 'powerup': {
        const base = 64 + semis
        const up = [0, 4, 7, 12, 16, 19, 24]
        up.forEach((s, i) => this.voice(ctx, this.fx, now + i * 0.045, base + s, 0.05, 0.035 * a, 'pulse25', 0.04))
        break
      }
      case 'jump': {
        this.sweep(ctx, now, 330 * Math.pow(2, semis / 12), 880 * Math.pow(2, semis / 12), 0.14, 0.035 * a, 'pulse25', 10)
        break
      }
      case 'hit': {
        this.sweep(ctx, now, 220, 60, 0.18, 0.05 * a, 'pulse50', 8)
        this.noiseHit(ctx, now, 1400, 0.06 * a, 0.12)
        break
      }
      case 'pause': {
        // the classic two-note pause chime (resume plays it a fourth higher)
        this.voice(ctx, this.fx, now, 76 + semis, 0.05, 0.035 * a, 'pulse50', 0.03)
        this.voice(ctx, this.fx, now + 0.07, 83 + semis, 0.05, 0.035 * a, 'pulse50', 0.03)
        this.voice(ctx, this.fx, now + 0.14, 76 + semis, 0.05, 0.03 * a, 'pulse50', 0.03)
        this.voice(ctx, this.fx, now + 0.21, 83 + semis, 0.1, 0.03 * a, 'pulse50', 0.08)
        break
      }
      case 'warp': {
        if (now - this.lastCut < 0.3) return
        this.lastCut = now
        // down into the pipe… and up out the other side
        const down = pitch < 0
        this.sweep(ctx, now, down ? 1100 : 160, down ? 160 : 1100, 0.32, 0.03 * a, 'pulse25', 16)
        this.sweep(ctx, now + 0.012, down ? 1110 : 162, down ? 162 : 1110, 0.32, 0.018 * a, 'triangle', 16)
        break
      }
    }
  }

  // ------------------------------------------------------------------ internals

  /** The running context, or null when sound is off / suspended / hidden. */
  private live() {
    const ctx = this.ctx
    if (!ctx || !this.enabled || this.hidden || ctx.state !== 'running') return null
    return ctx
  }

  private osc(ctx: AudioContext, wave: Wave) {
    const o = ctx.createOscillator()
    if (wave === 'triangle') o.type = 'triangle'
    else o.setPeriodicWave(this.waves[wave])
    return o
  }

  /** one enveloped note: fast attack, a short hold, exponential release */
  private voice(
    ctx: AudioContext,
    out: AudioNode,
    t: number,
    midi: number,
    dur: number,
    level: number,
    wave: Wave,
    release = 0.06,
  ) {
    const o = this.osc(ctx, wave)
    o.frequency.value = mtof(midi)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.004)
    g.gain.setValueAtTime(level, t + Math.max(0.005, dur * 0.6))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release)
    o.connect(g)
    g.connect(out)
    o.start(t)
    o.stop(t + dur + release + 0.02)
  }

  /** a pitch sweep in discrete steps (the way a sound chip slides) */
  private sweep(ctx: AudioContext, t: number, f0: number, f1: number, dur: number, level: number, wave: Wave, steps: number) {
    const o = this.osc(ctx, wave)
    for (let i = 0; i <= steps; i++) {
      const k = i / steps
      o.frequency.setValueAtTime(f0 * Math.pow(f1 / f0, k), t + k * dur)
    }
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.01)
    g.gain.setValueAtTime(level, t + dur * 0.7)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06)
    o.connect(g)
    g.connect(this.fx)
    o.start(t)
    o.stop(t + dur + 0.08)
  }

  private noiseHit(ctx: AudioContext, t: number, hp: number, level: number, decay: number, out: AudioNode = this.fx) {
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = hp
    const g = ctx.createGain()
    g.gain.setValueAtTime(level, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    src.connect(f)
    f.connect(g)
    g.connect(out)
    src.start(t, Math.random() * 0.5)
    src.stop(t + decay + 0.02)
  }

  private kick(ctx: AudioContext, t: number, level: number) {
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(160, t)
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11)
    const g = ctx.createGain()
    g.gain.setValueAtTime(level, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(g)
    g.connect(this.music)
    o.start(t)
    o.stop(t + 0.18)
  }

  /** keep the music scheduled a little ahead on the audio clock */
  private schedule = () => {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (this.nextStep < now) this.nextStep = now + 0.06
    while (this.nextStep < now + LOOKAHEAD) {
      // a level change lands on the next beat: one beat's rest, then bar 1 of the new tune
      if (this.pending && this.step % 4 === 0) {
        this.song = SONGS[this.pending] ?? SONGS.hero
        this.pending = null
        this.step = 0
        this.nextStep += (60 / this.song.bpm) * 1
        const lv = this.paused ? 0.18 : (this.song.level ?? 1)
        this.music.gain.setTargetAtTime(lv, this.nextStep, 0.05)
        continue
      }
      this.playStep(ctx, this.nextStep)
      this.step++
      this.nextStep += 60 / this.song.bpm / 4
    }
  }

  private playStep(ctx: AudioContext, t: number) {
    const s = this.song
    const sixteenth = 60 / s.bpm / 4
    const bar = Math.floor(this.step / 16)
    const st = this.step % 16
    const chord = s.prog[bar % s.prog.length]
    const root = s.root

    // arpeggio (16ths)
    const ai = s.arp[st]
    if (ai >= 0) {
      const tones = [chord[0], chord[1], chord[2], chord[0] + 12]
      const lv = 0.028 * s.arpLevel * (st % 4 === 0 ? 1 : 0.8)
      this.voice(ctx, this.music, t, root + tones[ai], sixteenth * 0.55, lv, s.arpWave, 0.05)
    }

    // bass (8ths)
    if (st % 2 === 0) {
      const bi = s.bass[st / 2]
      if (bi >= 0) {
        const note = root - 24 + chord[0] + [0, 7, 12][bi]
        this.voice(ctx, this.music, t, note, sixteenth * 1.4, 0.11, 'triangle', 0.05)
      }
    }

    // lead (8ths, with holds)
    if (s.lead && st % 2 === 0) {
      const phrase = s.lead[bar % s.lead.length]
      const li = phrase[st / 2]
      if (li >= 0) {
        let holds = 0
        for (let k = st / 2 + 1; k < phrase.length && phrase[k] === -2; k++) holds++
        const tones = [chord[0], chord[1], chord[2], chord[0] + 12, chord[1] + 12, chord[2] + 12]
        const dur = sixteenth * 2 * (1 + holds) * 0.85
        this.voice(ctx, this.music, t, root + 12 + tones[li], dur, 0.02, s.leadWave ?? 'pulse50', 0.12)
      }
    }

    // drums
    switch (s.drums) {
      case 'soft':
        if (st === 0 || st === 8) this.kick(ctx, t, 0.09)
        if (st % 4 === 2) this.noiseHit(ctx, t, 7000, 0.012, 0.03, this.music)
        break
      case 'march':
        if (st % 8 === 0) this.kick(ctx, t, 0.08)
        if (st % 8 === 4) this.noiseHit(ctx, t, 1800, 0.03, 0.09, this.music)
        if (st === 14) this.noiseHit(ctx, t, 1800, 0.018, 0.05, this.music)
        break
      case 'boss':
        if (st % 4 === 0) this.kick(ctx, t, st % 8 === 0 ? 0.1 : 0.07)
        if (st % 8 === 4) this.noiseHit(ctx, t, 1500, 0.035, 0.1, this.music)
        if (st % 2 === 1) this.noiseHit(ctx, t, 7500, 0.01, 0.025, this.music)
        break
    }
  }

  private applyTone() {
    const ctx = this.live()
    if (!ctx) return
    const lv = this.toneLevel * TONE_MAX
    const s = this.toneSent
    if (Math.abs(s.hz - this.toneHz) < 0.05 && Math.abs(s.level - lv) < 0.0005) return
    const now = ctx.currentTime
    this.toneOsc.frequency.setTargetAtTime(this.toneHz, now, 0.035)
    this.toneGain.gain.setTargetAtTime(lv, now, lv > s.level ? 0.07 : 0.16)
    s.hz = this.toneHz
    s.level = lv
  }

  private setEnabled(on: boolean) {
    if (on === this.enabled) return
    this.enabled = on
    setAudioSession(on ? 'playback' : 'auto')
    if (on) {
      try {
        this.ensureGraph()
      } catch (err) {
        console.warn('[hark] audio unavailable', err)
      }
    }
    this.applyRunning()
    for (const fn of this.onChange) fn(on)
  }

  private persist(on: boolean) {
    try {
      localStorage.setItem(STORE_KEY, on ? '1' : '0')
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  /** Resume + fade in, or fade out + suspend, based on enabled/hidden. */
  private applyRunning() {
    const ctx = this.ctx
    if (!ctx) return
    clearTimeout(this.suspendTimer)
    window.clearInterval(this.schedTimer)
    const now = ctx.currentTime
    if (this.enabled && !this.hidden) {
      ctx
        .resume()
        .then(() => {
          if (!this.enabled || this.hidden) return
          if (ctx.state !== 'running') return this.waitForGesture()
          const t = ctx.currentTime
          this.master.gain.cancelScheduledValues(t)
          this.master.gain.setValueAtTime(this.master.gain.value, t)
          this.master.gain.setTargetAtTime(MASTER_LEVEL, t, 0.25)
          this.toneSent.level = -1
          this.applyTone()
          // (re)start the current level's tune from its first bar
          this.song = SONGS[this.chapter] ?? SONGS.hero
          this.pending = null
          this.music.gain.setValueAtTime(this.paused ? 0.18 : (this.song.level ?? 1), t)
          this.step = 0
          this.nextStep = t + 0.12
          window.clearInterval(this.schedTimer)
          this.schedTimer = window.setInterval(this.schedule, 40)
          this.schedule()
        })
        .catch(() => this.waitForGesture())
    } else {
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.setTargetAtTime(0, now, this.hidden ? 0.05 : 0.15)
      this.suspendTimer = window.setTimeout(
        () => {
          if (!this.enabled || this.hidden) ctx.suspend().catch(() => {})
        },
        this.hidden ? 300 : 900,
      )
    }
  }

  /** Start audio on the first real gesture (remembered preference / blocked resume). */
  private waitForGesture() {
    if (this.gestureBound) return
    this.gestureBound = true
    const events = ['pointerdown', 'click', 'touchend', 'keydown'] as const
    const handler = (e: Event) => {
      // keyboard: only Enter / Space aimed at a control counts as "play"; Tab,
      // Shift+Tab, arrows, PageDown and Space-to-scroll are just moving around
      if (e instanceof KeyboardEvent) {
        if (!ACTIVATE_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
        if (!(e.target as Element | null)?.closest?.(CONTROL)) return
      }
      for (const ev of events) window.removeEventListener(ev, handler, true)
      this.gestureBound = false
      const onToggle = (e.target as Element | null)?.closest?.('[data-sound-toggle]')
      if (this.armed) {
        this.armed = false
        // the toggle's own click decides for itself
        if (!onToggle) this.setEnabled(true)
      } else if (this.enabled) this.applyRunning()
    }
    for (const ev of events) window.addEventListener(ev, handler, true)
  }

  private ensureGraph() {
    if (this.ctx) return
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC({ latencyHint: 'interactive' })
    this.ctx = ctx
    const now = ctx.currentTime
    this.waves = { pulse12: pulseWave(ctx, 0.125), pulse25: pulseWave(ctx, 0.25), pulse50: pulseWave(ctx, 0.5) }
    this.noise = noiseBuffer(ctx, 1)

    // master -> high-pass -> gentle glue compression -> out
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 35
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 14
    comp.ratio.value = 3
    comp.attack.value = 0.006
    comp.release.value = 0.25
    this.master.connect(hp)
    hp.connect(comp)
    comp.connect(ctx.destination)

    // the music bus: low-passed so the pulse waves stay soft, plus a short slap echo
    this.music = ctx.createGain()
    this.music.gain.value = 1
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3400
    lp.Q.value = 0.4
    this.music.connect(lp)
    lp.connect(this.master)
    const echo = ctx.createDelay(1)
    echo.delayTime.value = 0.19
    const fb = ctx.createGain()
    fb.gain.value = 0.22
    const wet = ctx.createGain()
    wet.gain.value = 0.16
    lp.connect(echo)
    echo.connect(fb)
    fb.connect(echo)
    echo.connect(wet)
    wet.connect(this.master)

    this.fx = ctx.createGain()
    this.fx.gain.value = 1
    const fxLp = ctx.createBiquadFilter()
    fxLp.type = 'lowpass'
    fxLp.frequency.value = 5200
    this.fx.connect(fxLp)
    fxLp.connect(this.master)

    // requested pure tone
    this.toneOsc = ctx.createOscillator()
    this.toneOsc.type = 'sine'
    this.toneOsc.frequency.value = this.toneHz
    this.toneGain = ctx.createGain()
    this.toneGain.gain.value = 0
    this.toneOsc.connect(this.toneGain)
    this.toneGain.connect(this.master)
    this.toneOsc.start(now)
  }
}
