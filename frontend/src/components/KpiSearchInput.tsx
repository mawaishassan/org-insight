"use client";

import React, { useState, useEffect, useRef } from "react";

interface KpiSearchInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

export function KpiSearchInput({
  value,
  onChange,
  placeholder = "Search KPIs…",
  style,
}: KpiSearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const prevValueRef = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Sync internal value ONLY when the parent prop value actually changes externally and user is not typing
  useEffect(() => {
    const isFocused = inputRef.current && document.activeElement === inputRef.current;
    if (!isFocused) {
      if (value !== prevValueRef.current) {
        setLocalValue(value);
        prevValueRef.current = value;
      }
    } else {
      // Keep prevValueRef in sync so if the parent catches up, we track it
      if (value === localValue) {
        prevValueRef.current = value;
      }
    }
  }, [value, localValue]);

  // Debounce the call to onChange
  useEffect(() => {
    const handler = setTimeout(() => {
      if (localValue !== value) {
        onChangeRef.current(localValue);
      }
    }, 200); // 200ms debounce
    return () => {
      clearTimeout(handler);
    };
  }, [localValue, value]);

  // Support pressing Enter for immediate search
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onChange(localValue);
    }
  };

  return (
    <input
      ref={inputRef}
      type="search"
      placeholder={placeholder}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onKeyDown={handleKeyDown}
      style={style}
    />
  );
}
