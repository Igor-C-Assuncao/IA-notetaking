// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
// src/shared/config/defaults.ts

export const DEFAULTS = {
  // LLM & Inference Defaults
  provider: 'ollama',
  model: 'llama3.1:8b',
  
  // Application Defaults
  theme: 'minimalist-notebook',
  systemAudio: false,
  autoSummarize: true,
  speakerDiarization: false,
  language: 'auto',
  systemPrompt: '',
  
  // State flags
  onboarding_completed: false,
};
