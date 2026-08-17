export interface CustomPeriodConfig {
  custom_period_name?: string;
  custom_period_start_month?: number;
  custom_period_start_day?: number;
  custom_period_duration_months?: number;
  custom_period_display_format?: string; // YYYY, YYYY/YY, YYYY-YY, YYYY-YYYY, YYYY–YYYY, YY/YYYY
  custom_period_prefix?: string;
  custom_period_suffix?: string;
}

/**
 * Format a start year into a custom period string based on Organization settings.
 */
export function formatPeriod(config: CustomPeriodConfig, startYear: number): string {
  const prefix = config.custom_period_prefix || "";
  const suffix = config.custom_period_suffix || "";
  const format = config.custom_period_display_format || "YYYY";
  const duration = config.custom_period_duration_months || 12;

  let body = "";
  if (format === "YYYY") {
    body = startYear.toString();
  } else if (format === "YYYY/YY") {
    // e.g. 2026/27
    const endYear = startYear + Math.ceil(duration / 12);
    const endYearStr = (endYear % 100).toString().padStart(2, "0");
    body = `${startYear}/${endYearStr}`;
  } else if (format === "YYYY-YY") {
    // e.g. 2026-27
    const endYear = startYear + Math.ceil(duration / 12);
    const endYearStr = (endYear % 100).toString().padStart(2, "0");
    body = `${startYear}-${endYearStr}`;
  } else if (format === "YYYY-YYYY") {
    // e.g. 2026-2027
    const endYear = startYear + Math.ceil(duration / 12);
    body = `${startYear}-${endYear}`;
  } else if (format === "YYYY–YYYY") {
    // e.g. 2026–2027 (dash)
    const endYear = startYear + Math.ceil(duration / 12);
    body = `${startYear}–${endYear}`;
  } else if (format === "YY/YYYY") {
    // e.g. 26/2027
    const endYear = startYear + Math.ceil(duration / 12);
    const startYearStr = (startYear % 100).toString().padStart(2, "0");
    body = `${startYearStr}/${endYear}`;
  } else {
    body = startYear.toString();
  }

  return `${prefix}${body}${suffix}`;
}

/**
 * Parse a formatted period string back to a numeric start year.
 */
export function parsePeriodToYear(config: CustomPeriodConfig, periodStr: string): number {
  const prefix = config.custom_period_prefix || "";
  const suffix = config.custom_period_suffix || "";
  const format = config.custom_period_display_format || "YYYY";
  const duration = config.custom_period_duration_months || 12;

  let val = periodStr;
  if (prefix && val.startsWith(prefix)) {
    val = val.slice(prefix.length);
  }
  if (suffix && val.endsWith(suffix)) {
    val = val.slice(0, -suffix.length);
  }
  val = val.trim();

  let startYear = new Date().getFullYear();
  if (format === "YYYY") {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) startYear = parsed;
  } else if (["YYYY/YY", "YYYY-YY", "YYYY-YYYY", "YYYY–YYYY"].includes(format)) {
    const parsed = parseInt(val.slice(0, 4), 10);
    if (!isNaN(parsed)) startYear = parsed;
  } else if (format === "YY/YYYY") {
    const endYear = parseInt(val.slice(-4), 10);
    if (!isNaN(endYear)) {
      const yearsDiff = Math.ceil(duration / 12);
      startYear = endYear - yearsDiff;
    }
  } else {
    const match = val.match(/\b\d{4}\b/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (!isNaN(parsed)) startYear = parsed;
    }
  }
  return startYear;
}

/**
 * Generate a list of dropdown options from (currentYear - range) to (currentYear + range).
 */
export function generatePeriodOptions(
  config: CustomPeriodConfig,
  currentYear: number = new Date().getFullYear(),
  range: number = 8
): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let y = currentYear - range; y <= currentYear + range; y++) {
    const formatted = formatPeriod(config, y);
    options.push({
      value: formatted,
      label: formatted,
    });
  }
  // Reverse to show newest years first
  return options.reverse();
}
