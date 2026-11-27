"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FEMALE_VOICE_HINTS } from "@/shared/persona";
import type { ReplyLanguage } from "@/shared/types";
import { phrases } from "./phrases";
import { synthesizeUrdu } from "./voice";

const SPEAK_KEY = "nexforce.speakReplies";
const VOICE_KEY = "nexforce.voiceName";
const hasSpeech = () => typeof window !== "undefined" && "speechSynthesis" in window;
const isFemale = (v: SpeechSynthesisVoice) => FEMALE_VOICE_HINTS.some((h) => v.name.toLowerCase().includes(h));
const isUrduText = (t: string) => /[\u0600-\u06FF]/.test(t);

/**
 * Spoken replies. English uses voices installed in Windows (online-only voices are never used).
 * Urdu uses a Windows Urdu voice if one exists, otherwise Piper on this computer.
 */
export function useSpeech({ urduTts }: { urduTts: boolean }) {
  const [enabled, setEnabledState] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceNameState] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    try {
      setEnabledState(localStorage.getItem(SPEAK_KEY) === "1");
      setVoiceNameState(localStorage.getItem(VOICE_KEY));
    } catch {
      // storage unavailable; use defaults
    }
    if (!hasSpeech()) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter((v) => v.localService));
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  /** Saved choice first, then a female voice, then any voice for the language. */
  const pickVoice = useCallback(
    (urdu: boolean): SpeechSynthesisVoice | undefined => {
      const candidates = voices.filter((v) => v.lang.toLowerCase().startsWith(urdu ? "ur" : "en"));
      if (!candidates.length) return undefined;
      return (
        (voiceName ? candidates.find((v) => v.name === voiceName) : undefined) ??
        candidates.find(isFemale) ??
        candidates[0]
      );
    },
    [voices, voiceName],
  );

  const cancel = useCallback(() => {
    tokenRef.current++;
    if (hasSpeech()) window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const speakWithPiper = useCallback((text: string) => {
    const token = ++tokenRef.current;
    setSpeaking(true); // also keeps the microphone paused while the audio is being made
    synthesizeUrdu(text)
      .then((blob) => {
        if (token !== tokenRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        const finish = () => {
          URL.revokeObjectURL(url);
          if (token === tokenRef.current) {
            audioRef.current = null;
            setSpeaking(false);
          }
        };
        audio.onended = finish;
        audio.onerror = () => {
          setError("The Urdu audio couldn't be played.");
          finish();
        };
        audio.play().catch((err: unknown) => {
          const name = err instanceof DOMException ? err.name : "";
          setError(
            name === "NotAllowedError"
              ? "Chrome blocked the sound. Click anywhere on the page once, then try again."
              : "The Urdu audio couldn't be played.",
          );
          finish();
        });
      })
      .catch((err: unknown) => {
        if (token !== tokenRef.current) return;
        setError(err instanceof Error ? err.message : "Urdu speech failed.");
        setSpeaking(false);
      });
  }, []);

  /** Speaks if replies are on. `force` speaks anyway (greetings and voice previews). */
  const speak = useCallback(
    (text: string, force = false): boolean => {
      if ((!enabled && !force) || !text.trim()) return false;
      setError(null);
      const urdu = isUrduText(text);
      const voice = hasSpeech() ? pickVoice(urdu) : undefined;

      if (urdu && !voice) {
        if (!urduTts) {
          setError("No Urdu voice is set up, so this reply is shown but not spoken.");
          return false;
        }
        cancel();
        speakWithPiper(text);
        return true;
      }
      if (!voice) {
        setError("No voice was found in Windows for this language.");
        return false;
      }

      cancel();
      const token = tokenRef.current;
      const u = new SpeechSynthesisUtterance(text.slice(0, 600));
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 1;
      u.pitch = 1.05;
      const finish = () => {
        if (token === tokenRef.current) setSpeaking(false);
      };
      u.onend = finish;
      u.onerror = finish;
      setSpeaking(true);
      window.speechSynthesis.speak(u);
      return true;
    },
    [enabled, pickVoice, urduTts, cancel, speakWithPiper],
  );

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      localStorage.setItem(SPEAK_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
    if (!on) cancel();
  }, [cancel]);

  const setVoiceName = useCallback((name: string) => {
    setVoiceNameState(name);
    try {
      localStorage.setItem(VOICE_KEY, name);
    } catch {
      // ignore
    }
  }, []);

  const preview = useCallback((lang: ReplyLanguage) => speak(phrases(lang).preview, true), [speak]);

  const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));

  return {
    enabled,
    setEnabled,
    speaking,
    error,
    speak,
    cancel,
    preview,
    englishVoices,
    currentEnglishVoice: pickVoice(false)?.name,
    setVoiceName,
    canSpeakUrdu: urduTts || voices.some((v) => v.lang.toLowerCase().startsWith("ur")),
  };
}

export type Speech = ReturnType<typeof useSpeech>;