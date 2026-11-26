import { Platform } from "react-native";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

/**
 * Voice input for the intake box (F-205, R02). Native uses
 * expo-speech-recognition (on-device where the OS offers it); on web
 * the same package wraps the browser Speech API where present
 * (Chrome). Where neither exists, isVoiceAvailable() is false and
 * the Speak button is hidden — never a button that does nothing.
 * Languages follow the story: bn-BD first, English second; the
 * transcript lands in the editable intake box, never auto-posted.
 */

export type VoiceCallbacks = {
  /** Interim + final transcript text (already cumulative). */
  onTranscript: (text: string) => void;
  onError: () => void;
  onEnd: () => void;
};

export function voiceLangFor(uiLang: string): string {
  return uiLang === "bn" ? "bn-BD" : "en-US";
}

export function isVoiceAvailable(): boolean {
  try {
    if (Platform.OS === "web") {
      const w = window as unknown as Record<string, unknown>;
      return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
    }
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

let subscriptions: { remove: () => void }[] = [];

export async function startListening(
  lang: string,
  callbacks: VoiceCallbacks,
): Promise<boolean> {
  stopListening();
  try {
    if (Platform.OS !== "web") {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        callbacks.onError();
        return false;
      }
    }
    subscriptions = [
      ExpoSpeechRecognitionModule.addListener("result", (event) => {
        const transcript = event.results?.[0]?.transcript;
        if (transcript) callbacks.onTranscript(transcript);
      }),
      ExpoSpeechRecognitionModule.addListener("error", () => {
        callbacks.onError();
        callbacks.onEnd();
      }),
      ExpoSpeechRecognitionModule.addListener("end", () => {
        callbacks.onEnd();
      }),
    ];
    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      continuous: false,
    });
    return true;
  } catch {
    callbacks.onError();
    return false;
  }
}

export function stopListening(): void {
  for (const sub of subscriptions) sub.remove();
  subscriptions = [];
  try {
    ExpoSpeechRecognitionModule.stop();
  } catch {
    // Not listening — nothing to stop.
  }
}
