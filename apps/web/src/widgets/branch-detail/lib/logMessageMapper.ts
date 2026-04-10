export function describeLogMessage(message: string) {
  const describeThresholdKind = (rawKind: string) => {
    const normalized = rawKind.trim().toLowerCase();
    if (normalized === "late") return "Late";
    if (normalized === "unassigned") return "Unassigned";
    return "Ready To Pickup";
  };

  const reapplyAfterGraceCapacityMatch = message.match(
    /^TEMP CLOSE — re-applied after external open grace \(Capacity (active|inPrep)=(\d+) cap=(\d+) (?:pickers|recentActivePickers)=(\d+)\)(?: until ([0-9]{2}:[0-9]{2}))?$/i,
  );
  if (reapplyAfterGraceCapacityMatch) {
    const metricKind = reapplyAfterGraceCapacityMatch[1]?.toLowerCase();
    const load = reapplyAfterGraceCapacityMatch[2];
    const cap = reapplyAfterGraceCapacityMatch[3];
    const pickers = reapplyAfterGraceCapacityMatch[4];
    const until = reapplyAfterGraceCapacityMatch[5];
    const loadLabel = metricKind === "inprep" ? "In Prep orders" : "Active orders";
    return {
      title: "Temporary close re-applied",
      detail: until
        ? `${loadLabel} stayed at ${load} above picker capacity ${cap} from ${pickers} recent active pickers (60m) after grace. Source timer ends at ${until}.`
        : `${loadLabel} stayed at ${load} above picker capacity ${cap} from ${pickers} recent active pickers (60m) after grace.`,
    };
  }

  const reapplyAfterGraceMatch = message.match(
    /^TEMP CLOSE — re-applied after external open grace \((Late|Unassigned|Ready To Pickup)=(\d+)\)(?: until ([0-9]{2}:[0-9]{2}))?$/i,
  );
  if (reapplyAfterGraceMatch) {
    const kind = describeThresholdKind(reapplyAfterGraceMatch[1]);
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
    /^TEMP CLOSE — Capacity (active|inPrep)=(\d+) cap=(\d+) (?:pickers|recentActivePickers)=(\d+)(?: until ([0-9]{2}:[0-9]{2}))?$/i,
  );
  if (capacityMatch) {
    const metricKind = capacityMatch[1]?.toLowerCase();
    const load = capacityMatch[2];
    const cap = capacityMatch[3];
    const pickers = capacityMatch[4];
    const until = capacityMatch[5];
    const loadLabel = metricKind === "inprep" ? "In Prep orders" : "Active orders";
    return {
      title: "Temporary close applied",
      detail: until
        ? `${loadLabel} reached ${load}, above picker capacity ${cap} from ${pickers} recent active pickers (60m). Source timer ends at ${until}.`
        : `${loadLabel} reached ${load}, above picker capacity ${cap} from ${pickers} recent active pickers (60m).`,
    };
  }

  const thresholdMatch = message.match(/^TEMP CLOSE — (Late|Unassigned|Ready To Pickup)=(\d+)(?: until ([0-9]{2}:[0-9]{2}))?$/i);
  if (thresholdMatch) {
    const kind = describeThresholdKind(thresholdMatch[1]);
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

  if (message === "OPEN — recovered to zero" || message === "OPEN — recovered to reopen threshold") {
    return {
      title: "Reopened by monitor",
      detail:
        message === "OPEN — recovered to zero"
          ? "The tracked trigger returned to zero."
          : "The tracked trigger returned to its reopen threshold.",
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
