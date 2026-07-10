// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
export function detectOS(): "mac" | "win" {
  const p = (navigator.platform || "").toLowerCase();
  const ua = (navigator.userAgent || "").toLowerCase();
  if (p.startsWith("win") || ua.includes("windows")) return "win";
  return "mac";
}
