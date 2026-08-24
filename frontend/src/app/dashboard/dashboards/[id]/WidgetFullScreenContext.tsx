"use client";

import React, { createContext, useContext, useState, useMemo } from "react";
import { type Widget } from "./widgets";

interface FullScreenNavigationContextProps {
  fullScreenWidgetId: string | null;
  setFullScreenWidgetId: (id: string | null) => void;
  goToNext: () => void;
  goToPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}

const WidgetFullScreenContext = createContext<boolean>(false);
const WidgetFullScreenNavigationContext = createContext<FullScreenNavigationContextProps | null>(null);

export function WidgetFullScreenProvider({ isFullScreen, children }: { isFullScreen: boolean; children: React.ReactNode }) {
  return <WidgetFullScreenContext.Provider value={isFullScreen}>{children}</WidgetFullScreenContext.Provider>;
}

export function useWidgetFullScreen() {
  return useContext(WidgetFullScreenContext);
}

export function WidgetFullScreenNavigationProvider({
  widgets,
  children,
}: {
  widgets: Widget[];
  children: React.ReactNode;
}) {
  const [fullScreenWidgetId, setFullScreenWidgetId] = useState<string | null>(null);

  // Filter out widgets that are empty or invalid, or do not support fullscreen mode (like single value cards or text widgets)
  const widgetIds = useMemo(() => {
    return widgets
      .filter((w) => w.type !== "kpi_single_value" && w.type !== "kpi_card_single_value" && w.type !== "text")
      .map((w) => w.id)
      .filter((id): id is string => typeof id === "string" && id !== "");
  }, [widgets]);

  const currentIndex = useMemo(() => {
    if (!fullScreenWidgetId) return -1;
    return widgetIds.indexOf(fullScreenWidgetId);
  }, [fullScreenWidgetId, widgetIds]);

  const hasNext = currentIndex !== -1 && currentIndex < widgetIds.length - 1;
  const hasPrev = currentIndex > 0;

  const goToNext = () => {
    if (hasNext) {
      setFullScreenWidgetId(widgetIds[currentIndex + 1]);
    }
  };

  const goToPrev = () => {
    if (hasPrev) {
      setFullScreenWidgetId(widgetIds[currentIndex - 1]);
    }
  };

  return (
    <WidgetFullScreenNavigationContext.Provider
      value={{
        fullScreenWidgetId,
        setFullScreenWidgetId,
        goToNext,
        goToPrev,
        hasNext,
        hasPrev,
      }}
    >
      {children}
    </WidgetFullScreenNavigationContext.Provider>
  );
}

export function useWidgetFullScreenNavigation() {
  const context = useContext(WidgetFullScreenNavigationContext);
  if (!context) {
    return {
      fullScreenWidgetId: null,
      setFullScreenWidgetId: () => {},
      goToNext: () => {},
      goToPrev: () => {},
      hasNext: false,
      hasPrev: false,
    };
  }
  return context;
}
