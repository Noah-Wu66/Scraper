const SHANGHAI_TIMEZONE = "Asia/Shanghai";

function parseHm(hour: number, minute: number) {
  return `${hour}`.padStart(2, "0") + ":" + `${minute}`.padStart(2, "0");
}

export function scheduleSummary(type: "daily" | "weekly", hour: number, minute: number, weekday?: number | null) {
  const base = parseHm(hour, minute);
  if (type === "weekly") {
    const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `${labels[weekday ?? 0]} ${base}`;
  }

  return `每天 ${base}`;
}

export function computeNextRunAt(options: {
  type: "daily" | "weekly";
  hour: number;
  minute: number;
  weekday?: number | null;
  from?: Date;
}) {
  const from = options.from ?? new Date();
  const local = new Date(
    from.toLocaleString("en-US", {
      timeZone: SHANGHAI_TIMEZONE,
    }),
  );
  const candidate = new Date(local);
  candidate.setSeconds(0, 0);
  candidate.setHours(options.hour, options.minute, 0, 0);

  if (options.type === "daily") {
    if (candidate <= local) {
      candidate.setDate(candidate.getDate() + 1);
    }
  } else {
    const targetWeekday = options.weekday ?? 0;
    const diff = (targetWeekday - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + diff);
    if (candidate <= local) {
      candidate.setDate(candidate.getDate() + 7);
    }
  }

  const tzValue = candidate.toLocaleString("sv-SE", { timeZone: SHANGHAI_TIMEZONE }).replace(" ", "T");
  return new Date(`${tzValue}+08:00`);
}
