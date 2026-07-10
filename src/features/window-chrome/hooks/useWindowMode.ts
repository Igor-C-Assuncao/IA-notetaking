// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useWindowMode() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const toggleWindowMode = async () => {
    if (isTransitioning) return;
    setIsTransitioning(true);

    await new Promise((r) => setTimeout(r, 100));

    try {
      if (isExpanded) {
        await invoke("set_compact_mode");
        setIsExpanded(false);
      } else {
        await invoke("set_expanded_mode");
        setIsExpanded(true);
      }
    } catch (e) {
      console.error("Window mode error:", e);
    }

    await new Promise((r) => setTimeout(r, 180));
    setIsTransitioning(false);
  };

  return { isExpanded, isTransitioning, toggleWindowMode };
}
