"use client";

import React, { createContext, useContext } from "react";

const WidgetFullScreenContext = createContext<boolean>(false);

export function WidgetFullScreenProvider({ isFullScreen, children }: { isFullScreen: boolean; children: React.ReactNode }) {
  return <WidgetFullScreenContext.Provider value={isFullScreen}>{children}</WidgetFullScreenContext.Provider>;
}

export function useWidgetFullScreen() {
  return useContext(WidgetFullScreenContext);
}
