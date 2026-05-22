// src/shared/config/defaults.ts

export const DEFAULTS = {
  // LLM & Inference Defaults
  provider: 'ollama',
  model: 'gemma4:e2b',
  
  // Application Defaults
  theme: 'liquid-glass',
  systemAudio: false,
  autoSummarize: true,
  speakerDiarization: false,
  language: 'auto',
  systemPrompt: '',
  
  // State flags
  onboarding_completed: false,
};
