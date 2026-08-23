// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção

// The mode itself lives in WindowModeProvider, mounted above EngineBootstrap so
// it survives bootstrap phase changes. This hook is only the consumer-side name
// its existing call sites already use.
export { useWindowModeContext as useWindowMode } from "../WindowModeProvider";
