export function describeLogMessage(message: string) {
  const reapplyAfterGraceCapacityMatch = message.match(
    /^TEMP CLOSE — re-applied after external open grace \(Capacity active=(\d+) cap=(\d+) pickers=(\d+)\)(?: until ([0-9]{2}:[0-9]{2}))?$/i,
  );
  if (reapplyAfterGraceCapacityMatch) {
    const active = reapplyAfterGraceCapacityMatch[1];
    const cap = reapplyAfterGraceCapacityMatch[2];
    const pickers = reapplyAfterGraceCapacityMatch[3];
    const until = reapplyAfterGraceCapacityMatch[4];
    return {
      title: "Temporary close re-applied",
      detail: until
        ? `Active orders stayed at ${active} above picker capacity ${cap} from ${pickers} last-hour pickers after grace. Source timer ends at ${until}.`
        : `Active orders stayed at ${active} above picker capacity ${cap} from ${pickers} last-hour pickers after grace.`,
    };
  }

  const reapplyAfterGraceMatch = message.match(
    /^TEMP CLOSE — re-applied after external open grace \((Late|Unassigned)=(\d+)\)(?: until ([0-9]{2}:[0-9]{2}))?$/i,
  );
  if (reapplyAfterGraceMatch) {
    const kind = reapplyAfterGraceMatch[1].toLowerCase() === "late" ? "Late" : "Unassigned";
    const count = reapplyAfterGraceMatch[2];
    const until = reapplyAfterGraceMatch[3];
    return {
      title: "Temporary close re-applied",
      detail: until
        ? `${kind} stayed at ${count} after grace. Source timer ends at ${until}.`
        : `${kind} stayed at ${count} after grace.`,
    };
  }

  const capacityMatch = message.match(
    /^TEMP CLOSE — Capacity active=(\d+) cap=(\d+) pickers=(\d+)(?: until ([0-9]{2}:[0-9]{2}))?$/i,
  );
  if (capacityMatch) {
    const active = capacityMatch[1];
    const cap = capacityMatch[2];
    const pickers = capacityMatch[3];
    const until = capacityMatch[4];
    return {
      title: "Temporary close applied",
      detail: until
        ? `Active orders reached ${active}, above picker capacity ${cap} from ${pickers} last-hour pickers. Source timer ends at ${until}.`
        : `Active orders reached ${active}, above picker capacity ${cap} from ${pickers} last-hour pickers.`,
    };
  }

  const thresholdMatch = message.match(/^TEMP CLOSE — (Late|Unassigned)=(\d+)(?: until ([0-9]{2}:[0-9]{2}))?$/i);
  if (thresholdMatch) {
    const kind = thresholdMatch[1].toLowerCase() === "late" ? "Late" : "Unassigned";
    const count = thresholdMatch[2];
    const until = thresholdMatch[3];
    return {
      title: "Temporary close applied",
      detail: until ? `${kind} reached ${count}. Source timer ends at ${until}.` : `${kind} reached ${count}.`,
    };
  }

  const externalCloseMatch = message.match(/^TEMP CLOSE — external source(?: until ([0-9]{2}:[0-9]{2}))?$/i);
  if (externalCloseMatch) {
    const until = externalCloseMatch[1];
    return {
      title: "Temporary close detected from source",
      detail: until ? `Source timer ends at ${until}.` : "Detected from the external availability feed.",
    };
  }

  if (message === "OPEN — recovered to zero") {
    return {
      title: "Reopened by monitor",
      detail: "The tracked trigger returned to zero.",
    };
  }

  if (message === "OPEN — source auto reopen after timer") {
    return {
      title: "Reopened automatically by source",
      detail: "The temporary closure timer elapsed normally.",
    };
  }

  if (message === "OPEN — external source reopened") {
    return {
      title: "Reopened by source",
      detail: "The external temporary closure is no longer active.",
    };
  }

  if (message === "OPEN — tracked close window expired after external reopen") {
    return {
      title: "Tracked close window expired",
      detail: "The branch had already reopened externally before the original timer ended.",
    };
  }

  if (message === "CLOSED — external source") {
    return {
      title: "Closed by source",
      detail: "The source switched from a temporary close to a full close.",
    };
  }

  if (message === "External open detected — grace started") {
    return {
      title: "External open detected",
      detail: "Grace window started before the monitor can close again.",
    };
  }

  if (message.startsWith("Skip action — ")) {
    return {
      title: "Action skipped",
      detail: message.replace("Skip action — ", ""),
    };
  }

  return { title: message, detail: "" };
}
