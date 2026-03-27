export interface ParsedWechatRow {
  title: string;
  url: string;
  publishedAt: string;
  readCount: number;
  likeCount: number;
  watchCount: number;
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseCount(text: string) {
  const source = String(text || "").replace(/\s+/g, "").replace(/[,\uFF0C]/g, "");
  if (!source) {
    return 0;
  }

  const matched = source.match(/([\d.]+)(万|亿)?/);
  if (!matched) {
    return Number(source) || 0;
  }

  let value = Number(matched[1]) || 0;
  if (matched[2] === "万") {
    value *= 10000;
  }
  if (matched[2] === "亿") {
    value *= 100000000;
  }
  return Math.round(value);
}

export function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuote = false;
  const source = stripBom(text);

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuote) {
      if (char === "\"") {
        if (source[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuote = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuote = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      field = "";
      if (row.some((item) => item.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((item) => item.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

export function parseWechatCsv(text: string) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return [] as ParsedWechatRow[];
  }

  const headers = rows[0].map((item) => item.trim());
  const get = (row: string[], key: string) => {
    const index = headers.indexOf(key);
    return index >= 0 ? row[index] ?? "" : "";
  };

  return rows.slice(1).map((row) => ({
    title: get(row, "标题").trim(),
    url: (get(row, "链接") || get(row, "长链接")).trim(),
    publishedAt: get(row, "日期").trim(),
    readCount: parseCount(get(row, "阅读数")),
    likeCount: parseCount(get(row, "点赞数")),
    watchCount: parseCount(get(row, "推荐数")),
  }));
}
