#!/usr/bin/env python3
"""
Offline CW decoder test tool.

Reads a WAV file (any sample rate, mono or stereo, 8/16/24/32-bit int or float)
and runs it through the same Goertzel + state-machine pipeline used by the live
decoder service.  Prints decoded text and timing diagnostics so you can verify
the algorithm without needing a live radio connection.

Usage:
    python3 tools/cw_decode_wav.py path/to/cw.wav [--freq HZ] [--threshold F] [--wpm N]

Options:
    --freq        Tone frequency to detect in Hz  (default: 700)
    --threshold   Adaptive threshold floor        (default: 0.02)
    --wpm         Expected WPM — used only to set initial dit estimate
                  so the state machine adapts faster (default: auto)
    --verbose     Print every ON/OFF event
"""
import argparse
import math
import struct
import sys
import wave


# ── constants (match cw_decoder_service.py) ──────────────────────────────────
BLOCK_SIZE      = 256
CHAR_GAP_FACTOR = 2.2
WORD_GAP_FACTOR = 4.5
WPM_SMOOTH      = 0.15
MIN_DIT_MS      = 20
MAX_ELEMENT_MS  = 800
SNR_SMOOTH      = 0.2

_MORSE: dict[str, str] = {
    ".-": "A",   "-...": "B", "-.-.": "C", "-..": "D",  ".": "E",
    "..-.": "F", "--.": "G",  "....": "H", "..": "I",   ".---": "J",
    "-.-": "K",  ".-..": "L", "--": "M",   "-.": "N",   "---": "O",
    ".--.": "P", "--.-": "Q", ".-.": "R",  "...": "S",  "-": "T",
    "..-": "U",  "...-": "V", ".--": "W",  "-..-": "X", "-.--": "Y",
    "--..": "Z",
    "-----": "0", ".----": "1", "..---": "2", "...--": "3", "....-": "4",
    ".....": "5", "-....": "6", "--...": "7", "---..": "8", "----.": "9",
    ".-.-.-": ".", "--..--": ",", "..--..": "?", ".----.": "'",
    "-.-.--": "!", "-..-.": "/",  "-.--.": "(",  "-.--.-": ")",
    ".-...": "&", "---...": ":", "-.-.-.": ";", "-...-": "=",
    ".-.-.": "+",  "-....-": "-", "..--.-": "_", ".-..-.": '"',
    "...-..-": "$", ".--.-.": "@", "...---...": "SOS",
}


# ── Goertzel ──────────────────────────────────────────────────────────────────

def goertzel_power(samples: list[float], target_freq: float, sample_rate: int) -> float:
    n = len(samples)
    k = int(0.5 + n * target_freq / sample_rate)
    omega = 2.0 * math.pi * k / n
    coeff = 2.0 * math.cos(omega)
    s0 = s1 = s2 = 0.0
    for x in samples:
        s0 = x + coeff * s1 - s2
        s2 = s1
        s1 = s0
    power = s1 * s1 + s2 * s2 - coeff * s1 * s2
    energy = sum(x * x for x in samples)
    if energy < 1e-6:
        return 0.0
    return power / energy


# ── State machine ─────────────────────────────────────────────────────────────

class CWStateMachine:
    def __init__(self, initial_wpm: float = 20.0) -> None:
        self._symbol_buf = ""
        self._decoded: list[str] = []
        self._dit_ms = 1200.0 / initial_wpm
        self._wpm = initial_wpm

    def on_tone(self, duration_ms: float) -> None:
        if duration_ms < MIN_DIT_MS:
            return
        if duration_ms > MAX_ELEMENT_MS:
            self._symbol_buf = ""
            return
        if len(self._symbol_buf) >= 9:
            self._symbol_buf = ""
            return
        if duration_ms <= self._dit_ms * 1.8:
            self._symbol_buf += "."
            self._update_dit(duration_ms)
        else:
            self._symbol_buf += "-"
            self._update_dit(duration_ms / 3.0)

    def on_space(self, duration_ms: float) -> None:
        if duration_ms < MIN_DIT_MS:
            return
        if duration_ms >= self._dit_ms * WORD_GAP_FACTOR:
            self._flush_char()
            if self._decoded:
                self._decoded.append(" ")
        elif duration_ms >= self._dit_ms * CHAR_GAP_FACTOR:
            self._flush_char()

    def _update_dit(self, ms: float) -> None:
        self._dit_ms = (1 - WPM_SMOOTH) * self._dit_ms + WPM_SMOOTH * ms
        self._wpm = (1 - WPM_SMOOTH) * self._wpm + WPM_SMOOTH * (1200.0 / max(self._dit_ms, 1))

    def _flush_char(self) -> None:
        if self._symbol_buf:
            self._decoded.append(_MORSE.get(self._symbol_buf, "?"))
            self._symbol_buf = ""

    @property
    def wpm(self) -> float:
        return self._wpm

    @property
    def text(self) -> str:
        return "".join(self._decoded)


# ── WAV loader ────────────────────────────────────────────────────────────────

def load_wav_mono_float(path: str) -> tuple[list[float], int]:
    """Return (samples_float, sample_rate).  Converts stereo→mono and normalises."""
    with wave.open(path, "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth  = wf.getsampwidth()   # bytes per sample per channel
        framerate  = wf.getframerate()
        n_frames   = wf.getnframes()
        raw        = wf.readframes(n_frames)

    total_samples = n_frames * n_channels

    if sampwidth == 1:          # unsigned 8-bit
        fmt = f"<{total_samples}B"
        raw_vals = [v - 128 for v in struct.unpack(fmt, raw)]
        scale = 128.0
    elif sampwidth == 2:        # signed 16-bit little-endian
        fmt = f"<{total_samples}h"
        raw_vals = list(struct.unpack(fmt, raw))
        scale = 32768.0
    elif sampwidth == 3:        # signed 24-bit little-endian
        raw_vals = []
        for i in range(total_samples):
            b = raw[i*3 : i*3+3]
            v = struct.unpack("<i", b + (b"\xff" if b[2] & 0x80 else b"\x00"))[0]
            raw_vals.append(v)
        scale = 8388608.0
    elif sampwidth == 4:        # signed 32-bit little-endian
        fmt = f"<{total_samples}i"
        raw_vals = list(struct.unpack(fmt, raw))
        scale = 2147483648.0
    else:
        raise ValueError(f"Unsupported sample width: {sampwidth} bytes")

    floats = [v / scale for v in raw_vals]

    # Stereo → mono (average channels)
    if n_channels == 2:
        floats = [(floats[i] + floats[i+1]) / 2.0 for i in range(0, len(floats), 2)]
    elif n_channels > 2:
        floats = [
            sum(floats[i+c] for c in range(n_channels)) / n_channels
            for i in range(0, len(floats), n_channels)
        ]

    return floats, framerate


# ── Main decode loop ──────────────────────────────────────────────────────────

def decode(samples: list[float], sample_rate: int,
           tone_freq: float, threshold: float,
           initial_wpm: float, verbose: bool) -> None:

    sm = CWStateMachine(initial_wpm)
    sample_buf = list(samples)

    tone_on = False
    segment_start = 0
    total = 0

    pwr_hi = 0.1
    pwr_lo = 0.001
    HI_SMOOTH = 0.10
    LO_SMOOTH = 0.10
    MIN_ON_BLOCKS  = 2
    MIN_OFF_BLOCKS = 2
    high_count = low_count = 0

    events: list[tuple[str, float, float, float]] = []   # (type, ms, power, thr)

    while len(sample_buf) >= BLOCK_SIZE:
        block = sample_buf[:BLOCK_SIZE]
        sample_buf = sample_buf[BLOCK_SIZE:]
        total += BLOCK_SIZE

        power = goertzel_power(block, tone_freq, sample_rate)

        adapt_thr = max(math.sqrt(max(pwr_hi, 1e-6) * max(pwr_lo, 1e-9)), threshold)
        raw_on = power >= adapt_thr
        if raw_on:
            pwr_hi = (1 - HI_SMOOTH) * pwr_hi + HI_SMOOTH * power
        else:
            pwr_lo = (1 - LO_SMOOTH) * pwr_lo + LO_SMOOTH * power

        if raw_on:
            high_count += 1
            low_count = 0
        else:
            high_count = 0
            low_count += 1

        if raw_on and not tone_on and high_count == MIN_ON_BLOCKS:
            tone_start = total - MIN_ON_BLOCKS * BLOCK_SIZE
            elapsed_ms = (tone_start - segment_start) * 1000.0 / sample_rate
            if verbose:
                print(f"  SPACE {elapsed_ms:6.0f}ms  pwr={power:.4f}  thr={adapt_thr:.4f}  buf={sm._symbol_buf!r}")
            events.append(("space", elapsed_ms, power, adapt_thr))
            sm.on_space(elapsed_ms)
            tone_on = True
            segment_start = tone_start

        elif not raw_on and tone_on and low_count == MIN_OFF_BLOCKS:
            tone_end = total - MIN_OFF_BLOCKS * BLOCK_SIZE
            elapsed_ms = (tone_end - segment_start) * 1000.0 / sample_rate
            if verbose:
                print(f"  TONE  {elapsed_ms:6.0f}ms  pwr={power:.4f}  thr={adapt_thr:.4f}  buf={sm._symbol_buf!r}")
            events.append(("tone", elapsed_ms, power, adapt_thr))
            sm.on_tone(elapsed_ms)
            tone_on = False
            segment_start = tone_end

    # Flush trailing tone/space
    if tone_on:
        elapsed_ms = (total - segment_start) * 1000.0 / sample_rate
        sm.on_tone(elapsed_ms)
    sm.on_space(MAX_ELEMENT_MS * 6.0)

    # ── Summary ──────────────────────────────────────────────────────────────
    tones  = [e for e in events if e[0] == "tone"]
    spaces = [e for e in events if e[0] == "space"]
    print()
    print(f"Decoded text : {sm.text!r}")
    print(f"Final WPM    : {sm.wpm:.1f}")
    print(f"Tone events  : {len(tones)}")
    print(f"Space events : {len(spaces)}")
    if tones:
        durs = sorted(e[1] for e in tones)
        print(f"Tone range   : {durs[0]:.0f} - {durs[-1]:.0f} ms  (median {durs[len(durs)//2]:.0f} ms)")
    if spaces:
        durs = sorted(e[1] for e in spaces if e[1] >= MIN_DIT_MS)
        if durs:
            print(f"Space range  : {durs[0]:.0f} - {durs[-1]:.0f} ms  (median {durs[len(durs)//2]:.0f} ms)")
    print()
    if tones:
        avg_pwr = sum(e[2] for e in tones) / len(tones)
        avg_thr = sum(e[3] for e in tones) / len(tones)
        print(f"Avg tone power : {avg_pwr:.4f}")
        print(f"Avg threshold  : {avg_thr:.4f}")
        print(f"Avg SNR ratio  : {avg_pwr/avg_thr:.1f}x")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Offline CW WAV decoder test")
    parser.add_argument("wav", help="WAV file to decode")
    parser.add_argument("--freq",      type=float, default=700.0, help="Tone frequency Hz (default 700)")
    parser.add_argument("--threshold", type=float, default=0.02,  help="Threshold floor (default 0.02)")
    parser.add_argument("--wpm",       type=float, default=20.0,  help="Expected WPM for initial dit estimate (default 20)")
    parser.add_argument("--verbose",   action="store_true",        help="Print every ON/OFF event")
    args = parser.parse_args()

    try:
        samples, rate = load_wav_mono_float(args.wav)
    except Exception as e:
        print(f"Error loading {args.wav}: {e}", file=sys.stderr)
        sys.exit(1)

    duration_s = len(samples) / rate
    print(f"File     : {args.wav}")
    print(f"Duration : {duration_s:.1f}s  ({len(samples):,} samples at {rate} Hz)")
    print(f"Tone freq: {args.freq} Hz   Threshold floor: {args.threshold}   Initial WPM: {args.wpm}")
    print()

    decode(samples, rate, args.freq, args.threshold, args.wpm, args.verbose)


if __name__ == "__main__":
    main()
