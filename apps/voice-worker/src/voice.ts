/**
 * STT / TTS provider interfaces with mock implementations, plus voice-OTP state.
 * Production swaps Deepgram (STT) and ElevenLabs/Cartesia (TTS) behind these
 * interfaces; the mocks let the whole voice loop run offline.
 */
export interface SttProvider {
  /** Map a (mock) audio chunk to a transcript. Here we pass text through. */
  transcribe(audioOrText: string): Promise<string>;
}

export interface TtsProvider {
  /** Map text to (mock) speech — returns the SSML/text to be spoken. */
  synthesize(text: string): Promise<string>;
}

export class MockStt implements SttProvider {
  async transcribe(audioOrText: string): Promise<string> {
    return audioOrText.trim();
  }
}

export class MockTts implements TtsProvider {
  async synthesize(text: string): Promise<string> {
    return text;
  }
}

/** Real STT via Deepgram's prerecorded listen API (base64 audio in → transcript out). */
export class DeepgramStt implements SttProvider {
  constructor(private readonly apiKey: string) {}
  async transcribe(audioBase64: string): Promise<string> {
    const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}`, 'content-type': 'audio/mulaw;rate=8000' },
      body: Buffer.from(audioBase64, 'base64'),
    });
    if (!res.ok) throw new Error(`deepgram ${res.status}`);
    const data = (await res.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  }
}

/** Real TTS via ElevenLabs. `synthesize` returns the text for TwiML <Say>; */
/** `synthesizeAudio` returns spoken audio bytes for the media-stream path. */
export class ElevenLabsTts implements TtsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly voiceId = '21m00Tcm4TlvDq8ikWAM',
  ) {}
  async synthesize(text: string): Promise<string> {
    return text;
  }
  async synthesizeAudio(text: string): Promise<Buffer> {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2' }),
    });
    if (!res.ok) throw new Error(`elevenlabs ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

/** Select real STT/TTS when API keys are present, else mocks. */
export function selectVoiceProviders(): { stt: SttProvider; tts: TtsProvider } {
  const stt = process.env.DEEPGRAM_API_KEY ? new DeepgramStt(process.env.DEEPGRAM_API_KEY) : new MockStt();
  const tts = process.env.ELEVENLABS_API_KEY ? new ElevenLabsTts(process.env.ELEVENLABS_API_KEY) : new MockTts();
  return { stt, tts };
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

/** Build a TwiML <Gather> that speaks a prompt then listens for speech. */
export function twimlGather(slug: string, prompt: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/voice/handle/${slug}" method="POST" speechTimeout="auto">
    <Say>${xmlEscape(prompt)}</Say>
  </Gather>
  <Say>I didn't catch that. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

export function twimlSayAndGather(slug: string, say: string, prompt: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${xmlEscape(say)}</Say>
  <Gather input="speech dtmf" action="/voice/handle/${slug}" method="POST" speechTimeout="auto">
    <Say>${xmlEscape(prompt)}</Say>
  </Gather>
  <Hangup/>
</Response>`;
}

export function twimlHangup(say?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>${say ? `\n  <Say>${xmlEscape(say)}</Say>` : ''}
  <Hangup/>
</Response>`;
}

/** Generate a 6-digit OTP. */
export function generateOtp(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 10);
  return s;
}
