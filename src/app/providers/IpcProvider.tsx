// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { createContext, useCallback, useContext, useEffect, useMemo, ReactNode, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { parsePythonEvent } from "@shared/lib/ipc";
import { PythonEvent } from "@shared/types/ipc-events";

type EventHandler = (event: PythonEvent) => void;

interface IpcContextType {
  subscribe: (handler: EventHandler) => () => void;
}

const IpcContext = createContext<IpcContextType | undefined>(undefined);

export function IpcProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<Set<EventHandler>>(new Set());

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<string>("python-event", (event) => {
      const parsed = parsePythonEvent(event.payload);
      if (parsed) {
        handlersRef.current.forEach(handler => handler(parsed));
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const subscribe = useCallback((handler: EventHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const value = useMemo(() => ({ subscribe }), [subscribe]);

  return (
    <IpcContext.Provider value={value}>
      {children}
    </IpcContext.Provider>
  );
}

export function usePythonEvent<T extends PythonEvent["event"]>(
  eventName: T,
  callback: (data: Extract<PythonEvent, { event: T }>["data"]) => void
) {
  const context = useContext(IpcContext);
  if (!context) throw new Error("usePythonEvent must be used within IpcProvider");
  
  const { subscribe } = context;
  
  // Use a ref for the callback so we don't resubscribe on every render
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const handler = (event: PythonEvent) => {
      if (event.event === eventName) {
        callbackRef.current(event.data as any);
      }
    };
    return subscribe(handler);
  }, [eventName, subscribe]);
}
