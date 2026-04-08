export interface CsvDocumentRow {
  lineNumber: number;
  values: string[];
}

export interface CsvDocument {
  header: string[];
  rows: CsvDocumentRow[];
}

export function parseCsvLine(line: string) {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      const next = line[index + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (inQuotes) {
    throw new Error("Malformed CSV row with unclosed quotes.");
  }

  out.push(current);
  return out;
}

export function parseCsvDocument(raw: string): CsvDocument {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.length > 0);
  if (!lines.length) {
    throw new Error("CSV file is empty.");
  }

  const header = parseCsvLine(lines[0]).map((value) => value.trim());
  if (!header.length || header.every((value) => !value)) {
    throw new Error("CSV header row is empty.");
  }

  const seenHeaders = new Set<string>();
  for (const column of header) {
    if (!column) {
      throw new Error("CSV contains an empty header name.");
    }
    const normalizedColumn = column.toLowerCase();
    if (seenHeaders.has(normalizedColumn)) {
      throw new Error(`CSV contains duplicate header "${column}".`);
    }
    seenHeaders.add(normalizedColumn);
  }

  return {
    header,
    rows: lines.slice(1).map((line, index) => ({
      lineNumber: index + 2,
      values: parseCsvLine(line),
    })),
  };
}
