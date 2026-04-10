import { Chip, Stack, Tooltip } from "@mui/material";

export function ScanoAssigneeChips(props: {
  names: string[];
  limit?: number;
  compact?: boolean;
}) {
  const limit = props.limit ?? 3;
  const visibleNames = props.names.slice(0, limit);
  const remainingNames = props.names.slice(limit);

  return (
    <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
      {visibleNames.map((name) => (
        <Chip
          key={name}
          size={props.compact ? "small" : "medium"}
          label={name}
          sx={{
            bgcolor: "rgba(15,23,42,0.06)",
            color: "#334155",
            fontWeight: 700,
          }}
        />
      ))}

      {remainingNames.length ? (
        <Tooltip
          title={remainingNames.join(", ")}
          arrow
          enterTouchDelay={0}
        >
          <Chip
            size={props.compact ? "small" : "medium"}
            label={`+${remainingNames.length}`}
            sx={{
              bgcolor: "rgba(219,234,254,0.9)",
              color: "#1d4ed8",
              fontWeight: 800,
              cursor: "help",
            }}
          />
        </Tooltip>
      ) : null}
    </Stack>
  );
}
