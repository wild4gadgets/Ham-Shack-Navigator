"""
CW (Morse code) decoder service.

Consumes raw PCM audio from the DAX RX queue produced by flexradio_service,
applies the Goertzel algorithm to detect tone on/off, then feeds a timing
state machine that converts dit/dah sequences to ASCII via a Morse dictionary.

Audio format assumed: 16-bit signed big-endian, mono, 48 000 Hz.
Goertzel is computed over 512-sample blocks (~21 ms windows).
Pure-Python implementation — no numpy — keeps CPU use low on Pi 4.
"""
import asyncio
import logging
import math
import struct
import time

from ws_manager import manager

logger = logging.getLogger(__name__)

# ── Tuneable constants ────────────────────────────────────────────────────────
SAMPLE_RATE       = 48_000     # Hz — FlexRadio DAX RX streams at 48 kHz
BLOCK_SIZE        = 512        # samples per Goertzel window (~21 ms)
DEFAULT_TONE_FREQ = 700.0      # Hz — CW sidetone to detect
DEFAULT_THRESHOLD = 0.15       # relative power threshold for tone-on detection
CHAR_GAP_FACTOR   = 2.2        # inter-character gap = 2.2 × dit duration
WORD_GAP_FACTOR   = 4.5        # inter-word gap = 4.5 × dit duration
WPM_SMOOTH        = 0.15       # EMA coefficient for WPM smoothing
MIN_DIT_MS        = 30         # ignore events shorter than this (noise floor)
MAX_DIT_MS        = 200        # dit longer than this → treat as dah minimum
MAX_ELEMENT_MS    = 800        # element longer than this is startup/gap noise — discard
SNR_SMOOTH        = 0.2        # EMA coefficient for SNR estimate

# ── Morse code dictionary ─────────────────────────────────────────────────────
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

def _goertzel_power(samples: list[float], target_freq: float, sample_rate: int) -> float:
    """
    Return the normalised Goertzel power [0.0 – 1.0] for target_freq in the
    block.  The result is normalised against total signal energy so it is
    largely independent of input gain.
    """
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

    # Normalise against RMS energy of block
    energy = sum(x * x for x in samples)
    if energy < 1e-12:
        return 0.0
    return power / energy


# ── State machine ─────────────────────────────────────────────────────────────

class _CWStateMachine:
    """
    Converts a stream of (tone_on: bool, duration_ms: float) events into
    decoded characters that it appends to a rolling buffer.
    """

    def __init__(self) -> None:
        self._symbol_buf: str = ""       # current character's dit/dah string
        self._decoded: list[str] = []    # recent decoded characters (ring, max 200)
        self._dit_ms: float = 50.0       # running dit duration estimate (EMA), start at ~24 WPM
        self._wpm: float = 24.0          # running WPM estimate
        self._snr: float = 0.0           # running SNR estimate

    # ── public ────────────────────────────────────────────────────────────────

    def on_tone(self, duration_ms: float) -> None:
        if duration_ms < MIN_DIT_MS:
            return  # noise
        if duration_ms > MAX_ELEMENT_MS:
            self._symbol_buf = ""  # startup / AGC transient — discard accumulated garbage
            return
        if len(self._symbol_buf) >= 9:
            self._symbol_buf = ""  # no valid Morse char exceeds 9 elements
            return
        if duration_ms <= self._dit_ms * 1.8:
            self._symbol_buf += "."
            self._update_dit(duration_ms)
        else:
            self._symbol_buf += "-"
            self._update_dit(duration_ms / 3.0)

    def on_space(self, duration_ms: float) -> None:
        if duration_ms < MIN_DIT_MS:
            return  # noise
        if duration_ms >= self._dit_ms * WORD_GAP_FACTOR:
            self._flush_char()
            if self._decoded:
                self._decoded.append(" ")
                self._trim()
        elif duration_ms >= self._dit_ms * CHAR_GAP_FACTOR:
            self._flush_char()

    def update_snr(self, tone_power: float, noise_power: float) -> None:
        if noise_power > 1e-9:
            ratio = 10.0 * math.log10(max(tone_power / noise_power, 1e-9))
        else:
            ratio = 0.0
        self._snr = (1 - SNR_SMOOTH) * self._snr + SNR_SMOOTH * ratio

    @property
    def wpm(self) -> int:
        return max(1, round(self._wpm))

    @property
    def snr(self) -> float:
        return round(self._snr, 1)

    @property
    def text(self) -> str:
        return "".join(self._decoded[-200:])

    # ── private ───────────────────────────────────────────────────────────────

    def _update_dit(self, ms: float) -> None:
        self._dit_ms = (1 - WPM_SMOOTH) * self._dit_ms + WPM_SMOOTH * ms
        self._wpm    = (1 - WPM_SMOOTH) * self._wpm    + WPM_SMOOTH * (1200.0 / max(self._dit_ms, 1))

    def _flush_char(self) -> None:
        if self._symbol_buf:
            char = _MORSE.get(self._symbol_buf, "?")
            self._decoded.append(char)
            self._trim()
            self._symbol_buf = ""

    def _trim(self) -> None:
        if len(self._decoded) > 200:
            self._decoded = self._decoded[-200:]


# ── Background task ───────────────────────────────────────────────────────────

_decoder_task: asyncio.Task | None = None
_tone_freq: float = DEFAULT_TONE_FREQ
_threshold: float = DEFAULT_THRESHOLD
_enabled: bool = True


async def _decode_loop(queue: asyncio.Queue) -> None:
    sm = _CWStateMachine()
    sample_buf: list[float] = []

    tone_on = False
    segment_start_sample: int = 0   # audio-sample index when current segment began
    total_samples: int = 0          # total samples processed so far
    noise_ema: float = 1e-6         # background power EMA for SNR

    # Adaptive threshold: tracks separate on/off power levels and thresholds at
    # their geometric mean.  Immune to AGC-induced level shifts.
    pwr_hi: float = 0.5    # EMA of power while tone is on
    pwr_lo: float = 0.001  # EMA of power while tone is off
    HI_SMOOTH = 0.05
    LO_SMOOTH = 0.05

    # Symmetric debounce: require consecutive blocks in the same state before
    # committing a transition.  Filters 1-block AGC/filter ring-down artifacts.
    # At 5 WPM (W1AW slow) dits are 240ms = 22 blocks; at 40 WPM ~3 blocks.
    # 2 blocks on = 21ms min tone, 3 blocks off = 32ms min silence.
    MIN_ON_BLOCKS  = 2
    MIN_OFF_BLOCKS = 5
    high_count: int = 0    # consecutive above-threshold block counter
    low_count: int  = 0    # consecutive below-threshold block counter

    last_broadcast: float = 0.0
    last_status_broadcast: float = 0.0
    last_text: str = ""

    logger.info(
        "CW decoder started — freq=%.0f Hz threshold=%.2f", _tone_freq, _threshold
    )

    while True:
        try:
            pcm_bytes: bytes = await asyncio.wait_for(queue.get(), timeout=0.5)
        except asyncio.TimeoutError:
            # Flush any pending tone or symbol when the stream goes quiet
            if tone_on:
                elapsed_ms = (total_samples - segment_start_sample) * 1000.0 / SAMPLE_RATE
                sm.on_tone(elapsed_ms)
            sm.on_space(MAX_DIT_MS * 6.0)
            tone_on = False
            high_count = 0
            low_count = 0
            segment_start_sample = total_samples
            continue
        except asyncio.CancelledError:
            logger.info("CW decoder task cancelled")
            return

        # Unpack 16-bit signed big-endian samples
        n_samples = len(pcm_bytes) // 2
        samples = [
            struct.unpack_from(">h", pcm_bytes, i * 2)[0] / 32768.0
            for i in range(n_samples)
        ]
        sample_buf.extend(samples)

        # Process complete blocks
        while len(sample_buf) >= BLOCK_SIZE:
            block = sample_buf[:BLOCK_SIZE]
            sample_buf = sample_buf[BLOCK_SIZE:]
            total_samples += BLOCK_SIZE

            power = _goertzel_power(block, _tone_freq, SAMPLE_RATE)

            # Update SNR estimate
            if not tone_on:
                noise_ema = 0.98 * noise_ema + 0.02 * power
            sm.update_snr(power, noise_ema)

            # Adaptive threshold: geometric mean of the on/off power EMAs.
            # Compute raw_on first, then update EMAs based on it so ring-down
            # blocks don't corrupt pwr_hi during the OFF debounce window.
            adapt_thr = math.sqrt(max(pwr_hi, 1e-6) * max(pwr_lo, 1e-9))
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

            # Symmetric debounce: commit a transition only after MIN_ON/OFF_BLOCKS
            # consecutive blocks in the new state.  Back-date segment_start to the
            # actual transition point (before the debounce window).
            if raw_on and not tone_on and high_count == MIN_ON_BLOCKS:
                # Rising edge confirmed — tone started MIN_ON_BLOCKS ago
                tone_start_sample = total_samples - MIN_ON_BLOCKS * BLOCK_SIZE
                elapsed_ms = (tone_start_sample - segment_start_sample) * 1000.0 / SAMPLE_RATE
                logger.info("CW ON  %.0fms pwr=%.3f thr=%.3f buf=%r",
                            elapsed_ms, power, adapt_thr, sm._symbol_buf)
                sm.on_space(elapsed_ms)
                tone_on = True
                segment_start_sample = tone_start_sample
            elif not raw_on and tone_on and low_count == MIN_OFF_BLOCKS:
                # Falling edge confirmed — silence started MIN_OFF_BLOCKS ago
                tone_end_sample = total_samples - MIN_OFF_BLOCKS * BLOCK_SIZE
                elapsed_ms = (tone_end_sample - segment_start_sample) * 1000.0 / SAMPLE_RATE
                logger.info("CW off %.0fms pwr=%.3f thr=%.3f buf=%r",
                            elapsed_ms, power, adapt_thr, sm._symbol_buf)
                sm.on_tone(elapsed_ms)
                tone_on = False
                segment_start_sample = tone_end_sample

            now = time.monotonic()
            # Broadcast when text changes (up to 4x/sec), or SNR-only every 2s
            if now - last_broadcast >= 0.25:
                current_text = sm.text
                if current_text != last_text:
                    await manager.broadcast({
                        "type": "cw_decode",
                        "text": current_text,
                        "wpm": sm.wpm,
                        "snr": sm.snr,
                    })
                    last_text = current_text
                    last_status_broadcast = now
                last_broadcast = now
            elif now - last_status_broadcast >= 2.0:
                await manager.broadcast({
                    "type": "cw_decode",
                    "text": sm.text,
                    "wpm": sm.wpm,
                    "snr": sm.snr,
                })
                last_status_broadcast = now


def start_decoder(queue: asyncio.Queue, tone_freq: float = DEFAULT_TONE_FREQ,
                  threshold: float = DEFAULT_THRESHOLD) -> None:
    """Start the CW decoder background task."""
    global _decoder_task, _tone_freq, _threshold
    _tone_freq = tone_freq
    _threshold = threshold
    if _decoder_task is None or _decoder_task.done():
        _decoder_task = asyncio.create_task(_decode_loop(queue))
        logger.info("CW decoder task created")


def stop_decoder() -> None:
    """Cancel the CW decoder background task."""
    global _decoder_task
    if _decoder_task and not _decoder_task.done():
        _decoder_task.cancel()
        _decoder_task = None


def get_status() -> dict:
    """Return current decoder status for the REST status endpoint."""
    return {
        "active": _decoder_task is not None and not _decoder_task.done(),
        "tone_freq": _tone_freq,
        "threshold": _threshold,
    }
