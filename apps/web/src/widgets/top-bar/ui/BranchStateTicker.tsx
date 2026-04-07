import AccessTimeFilledRoundedIcon from "@mui/icons-material/AccessTimeFilledRounded";
import CancelRoundedIcon from "@mui/icons-material/CancelRounded";
import CircleRoundedIcon from "@mui/icons-material/CircleRounded";
import { Box, Chip, Divider, Popover, Stack, Typography } from "@mui/material";
import { memo, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { BranchSnapshot } from "../../../api/types";

function BranchStatusSection(props: {
  title: string;
  tone: "open" | "tempClose" | "closed" | "unknown";
  items: Array<Pick<BranchSnapshot, "branchId" | "name" | "status">>;
}) {
  const meta =
    props.tone === "open"
      ? { chipLabel: "Open", chipBg: "#e7f7ed", chipColor: "#166534", titleColor: "#166534" }
      : props.tone === "tempClose"
        ? { chipLabel: "Temporary Close", chipBg: "#fff1f2", chipColor: "#be123c", titleColor: "#be123c" }
        : props.tone === "closed"
          ? { chipLabel: "Closed", chipBg: "#fff7d6", chipColor: "#92400e", titleColor: "#92400e" }
          : { chipLabel: "Unknown", chipBg: "#eef2f7", chipColor: "#475569", titleColor: "#475569" };

  return (
    <Box
      sx={{
        border: "1px solid rgba(148,163,184,0.12)",
        borderRadius: 2.5,
        overflow: "hidden",
        "&:not(:last-of-type)": {
          mb: 1,
        },
      }}
    >
      <Box
        sx={{
          px: 1.15,
          py: 0.85,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          bgcolor: "rgba(248,250,252,0.78)",
        }}
      >
        <Typography sx={{ fontWeight: 900, color: meta.titleColor, lineHeight: 1.1 }}>{props.title}</Typography>
        <Chip
          size="small"
          label={props.items.length}
          sx={{
            height: 22,
            fontWeight: 900,
            bgcolor: meta.chipBg,
            color: meta.chipColor,
            border: "1px solid rgba(15,23,42,0.06)",
          }}
        />
      </Box>

      <Divider />

      {props.items.length ? (
        <Stack spacing={0}>
          {props.items.map((branch, index) => (
            <Box
              key={branch.branchId}
              sx={{
                px: 1.15,
                py: 0.9,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                ...(index < props.items.length - 1 ? { borderBottom: "1px solid rgba(148,163,184,0.10)" } : {}),
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  minWidth: 0,
                  flex: 1,
                  fontWeight: 700,
                  color: "#0f172a",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={branch.name}
              >
                {branch.name}
              </Typography>

              <Chip
                size="small"
                label={meta.chipLabel}
                sx={{
                  fontWeight: 800,
                  bgcolor: meta.chipBg,
                  color: meta.chipColor,
                }}
              />
            </Box>
          ))}
        </Stack>
      ) : (
        <Box sx={{ px: 1.15, py: 1 }}>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            No branches
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function StateDot(props: {
  icon: ReactNode;
  count: number;
  iconBg: string;
  iconColor: string;
  title: string;
}) {
  return (
    <Stack direction="row" spacing={0.55} alignItems="center" title={props.title}>
      <Box
        sx={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          bgcolor: props.iconBg,
          color: props.iconColor,
          "& svg": {
            color: props.iconColor,
          },
        }}
      >
        {props.icon}
      </Box>
      <Typography sx={{ fontWeight: 900, fontSize: 15, lineHeight: 1, color: "#0f172a" }}>{props.count}</Typography>
    </Stack>
  );
}

function BranchStateTickerBase(props: {
  branches: Array<Pick<BranchSnapshot, "branchId" | "name" | "status">>;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const grouped = useMemo(
    () => ({
      open: props.branches.filter((branch) => branch.status === "OPEN"),
      tempClose: props.branches.filter((branch) => branch.status === "TEMP_CLOSE"),
      closed: props.branches.filter((branch) => branch.status === "CLOSED"),
      unknown: props.branches.filter((branch) => branch.status === "UNKNOWN"),
    }),
    [props.branches],
  );

  const popoverOpen = Boolean(anchorEl);

  const onOpen = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const onClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <Stack
        direction="row"
        spacing={1.1}
        alignItems="center"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setAnchorEl(event.currentTarget as HTMLElement);
          }
        }}
        sx={{
          px: 1.4,
          py: 0.75,
          borderRadius: "999px",
          border: "1px solid rgba(17,24,39,0.10)",
          bgcolor: "rgba(255,255,255,0.96)",
          cursor: "pointer",
          transition: "box-shadow 160ms ease, border-color 160ms ease, background-color 160ms ease",
          boxShadow: "none",
          "&:hover": {
            boxShadow: "0 8px 20px rgba(15,23,42,0.08)",
            borderColor: "rgba(17,24,39,0.16)",
          },
          "&:focus-visible": {
            outline: "2px solid rgba(37,99,235,0.24)",
            outlineOffset: 2,
          },
        }}
      >
        <StateDot
          icon={<CancelRoundedIcon sx={{ fontSize: 15 }} />}
          count={grouped.closed.length}
          iconBg="#d92d20"
          iconColor="#ffffff"
          title="Closed"
        />
        <StateDot
          icon={<CircleRoundedIcon sx={{ fontSize: 13 }} />}
          count={grouped.open.length}
          iconBg="rgba(22,163,74,0.14)"
          iconColor="#16a34a"
          title="Open"
        />
        <StateDot
          icon={<AccessTimeFilledRoundedIcon sx={{ fontSize: 14 }} />}
          count={grouped.tempClose.length}
          iconBg="#111827"
          iconColor="#ffffff"
          title="Temporary Close"
        />
        <StateDot
          icon={<CircleRoundedIcon sx={{ fontSize: 13 }} />}
          count={grouped.unknown.length}
          iconBg="rgba(100,116,139,0.14)"
          iconColor="#64748b"
          title="Unknown"
        />
      </Stack>

      <Popover
        open={popoverOpen}
        anchorEl={anchorEl}
        onClose={onClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            mt: 1,
            width: 420,
            maxWidth: "calc(100vw - 24px)",
            borderRadius: 3,
            border: "1px solid rgba(148,163,184,0.14)",
            boxShadow: "0 22px 46px rgba(15,23,42,0.12)",
            overflow: "hidden",
          },
        }}
      >
        <Box sx={{ px: 1.5, py: 1.3, borderBottom: "1px solid rgba(148,163,184,0.12)", bgcolor: "rgba(248,250,252,0.75)" }}>
          <Typography sx={{ fontWeight: 900, lineHeight: 1.1 }}>Branch Status List</Typography>
        </Box>

        <Box sx={{ maxHeight: 420, overflowY: "auto", p: 1.2 }}>
          <BranchStatusSection title="Temporary Close" tone="tempClose" items={grouped.tempClose} />
          <BranchStatusSection title="Open" tone="open" items={grouped.open} />
          <BranchStatusSection title="Closed" tone="closed" items={grouped.closed} />
          <BranchStatusSection title="Unknown" tone="unknown" items={grouped.unknown} />
        </Box>
      </Popover>
    </>
  );
}

export const BranchStateTicker = memo(BranchStateTickerBase);
