export type DictationError = string;

type RecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
};

export function canDictate(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function startDictation(opts: {
  onInterim: (t: string) => void;
  onFinal: (t: string) => void;
  onError: (e: DictationError) => void;
}): () => void {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) {
    opts.onError("SpeechRecognition not available in this browser");
    return () => undefined;
  }
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || "en-US";
  rec.onresult = (ev) => {
    let interim = "";
    let finals = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finals += t;
      else interim += t;
    }
    if (interim) opts.onInterim(interim);
    if (finals) opts.onFinal(finals);
  };
  rec.onerror = (ev) => opts.onError(ev.error);
  rec.start();
  return () => rec.stop();
}
