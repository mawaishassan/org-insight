import React, { useState, useEffect, useRef } from "react";

interface CustomDatePickerProps {
  id?: string;
  value?: string; // Expects "YYYY-MM-DD"
  onChange: (val?: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function CustomDatePicker({
  id,
  value,
  onChange,
  disabled = false,
  style,
  className = "",
}: CustomDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse initial date value or default to current date
  const getInitialState = () => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parts = value.split("-");
      return {
        year: parseInt(parts[0], 10),
        month: parseInt(parts[1], 10) - 1, // 0-indexed month
      };
    }
    const today = new Date();
    return {
      year: today.getFullYear(),
      month: today.getMonth(),
    };
  };

  const [currentYear, setCurrentYear] = useState(getInitialState().year);
  const [currentMonth, setCurrentMonth] = useState(getInitialState().month);

  // Sync state if value changes externally
  useEffect(() => {
    const state = getInitialState();
    setCurrentYear(state.year);
    setCurrentMonth(state.month);
  }, [value]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  // Generate list of years (e.g., current year +/- 50 years)
  const baseYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = baseYear - 100; y <= baseYear + 50; y++) {
    years.push(y);
  }

  // Get days in a month
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  // Get day of week the month starts on
  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const yStr = String(currentYear);
    const mStr = String(currentMonth + 1).padStart(2, "0");
    const dStr = String(day).padStart(2, "0");
    const formatted = `${yStr}-${mStr}-${dStr}`;
    onChange(formatted);
    setIsOpen(false);
  };

  const handleToday = () => {
    const today = new Date();
    const yStr = String(today.getFullYear());
    const mStr = String(today.getMonth() + 1).padStart(2, "0");
    const dStr = String(today.getDate()).padStart(2, "0");
    const formatted = `${yStr}-${mStr}-${dStr}`;
    onChange(formatted);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange(undefined);
    setIsOpen(false);
  };

  // Render day cells
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const dayCells: React.ReactNode[] = [];

  // Empty cells for alignment before start of month
  for (let i = 0; i < firstDay; i++) {
    dayCells.push(<div key={`empty-${i}`} className="datepicker-day empty" />);
  }

  // Actual days
  for (let day = 1; day <= daysInMonth; day++) {
    const isSelected =
      value ===
      `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isToday =
      new Date().toDateString() ===
      new Date(currentYear, currentMonth, day).toDateString();

    dayCells.push(
      <button
        key={`day-${day}`}
        type="button"
        className={`datepicker-day${isSelected ? " selected" : ""}${isToday ? " today-highlight" : ""}`}
        onClick={() => handleSelectDay(day)}
      >
        {day}
      </button>
    );
  }

  // Format date display in text field
  const getDisplayValue = () => {
    if (!value) return "";
    return value; // Or format as local date display format if wanted
  };

  return (
    <div
      ref={containerRef}
      className={`datepicker-container ${className}`}
      style={{ position: "relative", display: "inline-block", width: "100%", ...style }}
    >
      <div style={{ position: "relative", width: "100%" }}>
        <input
          id={id}
          type="text"
          readOnly
          disabled={disabled}
          placeholder="YYYY-MM-DD"
          value={getDisplayValue()}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          style={{
            width: "100%",
            padding: "0.35rem 2rem 0.35rem 0.5rem",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            cursor: disabled ? "not-allowed" : "pointer",
            outline: "none",
          }}
        />
        <span
          onClick={() => !disabled && setIsOpen(!isOpen)}
          style={{
            position: "absolute",
            right: "0.6rem",
            top: "50%",
            transform: "translateY(-50%)",
            cursor: disabled ? "not-allowed" : "pointer",
            color: "var(--muted)",
            display: "flex",
            alignItems: "center",
            userSelect: "none"
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </span>
      </div>

      {isOpen && (
        <div
          className="datepicker-popover"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 1000,
            marginTop: "4px",
            padding: "0.45rem",
            background: "var(--bg, #ffffff)",
            border: "1px solid var(--border, #e2e8f0)",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
            borderRadius: "8px",
            width: "230px",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.5rem",
              gap: "4px",
            }}
          >
            <button
              type="button"
              onClick={handlePrevMonth}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "2px 4px",
                color: "var(--text)",
                fontSize: "0.85rem",
              }}
            >
              &lt;
            </button>

            <div style={{ display: "flex", gap: "4px", flex: 1, justifyContent: "center" }}>
              <select
                value={currentMonth}
                onChange={(e) => setCurrentMonth(parseInt(e.target.value, 10))}
                style={{
                  padding: "1px 2px",
                  borderRadius: "4px",
                  border: "1px solid var(--border)",
                  fontSize: "0.75rem",
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              >
                {months.map((m, idx) => (
                  <option key={m} value={idx}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                value={currentYear}
                onChange={(e) => setCurrentYear(parseInt(e.target.value, 10))}
                style={{
                  padding: "1px 2px",
                  borderRadius: "4px",
                  border: "1px solid var(--border)",
                  fontSize: "0.75rem",
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "2px 4px",
                color: "var(--text)",
                fontSize: "0.85rem",
              }}
            >
              &gt;
            </button>
          </div>

          {/* Weekday headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              textAlign: "center",
              fontWeight: 600,
              fontSize: "0.7rem",
              color: "var(--muted)",
              marginBottom: "4px",
            }}
          >
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
              <div key={day} style={{ padding: "2px 0" }}>
                {day}
              </div>
            ))}
          </div>

          {/* Day Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: "2px",
            }}
          >
            {dayCells}
          </div>

          {/* Popover Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "0.4rem",
              paddingTop: "0.3rem",
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              onClick={handleClear}
              style={{
                background: "transparent",
                border: "none",
                color: "#e53e3e",
                fontSize: "0.72rem",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleToday}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--primary, #3182ce)",
                fontSize: "0.72rem",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Today
            </button>
          </div>
        </div>
      )}

      {/* Styled JSX styles for popup calendar days */}
      <style jsx global>{`
        .datepicker-day {
          background: transparent;
          border: none;
          border-radius: 4px;
          padding: 4px 0;
          font-size: 0.76rem;
          text-align: center;
          cursor: pointer;
          color: var(--text);
        }
        .datepicker-day:hover {
          background: var(--border, #edf2f7);
        }
        .datepicker-day.selected {
          background: var(--primary, #3182ce) !important;
          color: #ffffff !important;
          font-weight: bold;
        }
        .datepicker-day.today-highlight {
          border: 1px solid var(--primary, #3182ce);
          font-weight: 600;
        }
        .datepicker-day.empty {
          cursor: default;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
