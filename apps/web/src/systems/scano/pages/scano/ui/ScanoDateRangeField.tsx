import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import { Box, Button, Popover, Stack, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function formatButtonDate(value: string) {
  if (!value) return "--/--/----";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function endOfWeek(date: Date) {
  const next = startOfWeek(date);
  next.setDate(next.getDate() + 6);
  return next;
}

interface ScanoDateRangeFieldProps {
  startDate: string;
  endDate: string;
  onChange: (next: { startDate: string; endDate: string }) => void;
}

export function ScanoDateRangeField(props: ScanoDateRangeFieldProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [draftStart, setDraftStart] = useState(props.startDate);
  const [draftEnd, setDraftEnd] = useState(props.endDate);

  const open = Boolean(anchorEl);
  const buttonLabel = useMemo(() => {
    if (!props.startDate && !props.endDate) {
      return "All dates";
    }
    return `${formatButtonDate(props.startDate)} - ${formatButtonDate(props.endDate)}`;
  }, [props.endDate, props.startDate]);

  function applyRange(next: { startDate: string; endDate: string }) {
    setDraftStart(next.startDate);
    setDraftEnd(next.endDate);
    props.onChange(next);
  }

  return (
    <>
      <Button
        variant="outlined"
        onClick={(event) => {
          setDraftStart(props.startDate);
          setDraftEnd(props.endDate);
          setAnchorEl(event.currentTarget);
        }}
        startIcon={<CalendarMonthRoundedIcon />}
        sx={{
          justifyContent: "flex-start",
          minWidth: { xs: "100%", md: 240 },
          px: 1.4,
          py: 1,
          borderRadius: 2,
          borderColor: "rgba(148,163,184,0.22)",
          color: "#0f172a",
          bgcolor: "rgba(255,255,255,0.88)",
        }}
      >
        {buttonLabel}
      </Button>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        PaperProps={{
          sx: {
            mt: 1,
            p: 1.6,
            width: 360,
            borderRadius: 3,
            border: "1px solid rgba(148,163,184,0.16)",
            boxShadow: "0 22px 44px rgba(15,23,42,0.12)",
          },
        }}
      >
        <Stack spacing={1.4}>
          <Typography variant="subtitle2" sx={{ fontWeight: 900, color: "#0f172a" }}>
            Task Date Range
          </Typography>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              label="Start Date"
              type="date"
              value={draftStart}
              onChange={(event) => setDraftStart(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="End Date"
              type="date"
              value={draftEnd}
              onChange={(event) => setDraftEnd(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>

          <Stack direction="row" spacing={1} justifyContent="space-between">
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                const today = toDateInputValue(new Date());
                applyRange({ startDate: today, endDate: today });
                setAnchorEl(null);
              }}
            >
              Today
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                const now = new Date();
                applyRange({
                  startDate: toDateInputValue(startOfWeek(now)),
                  endDate: toDateInputValue(endOfWeek(now)),
                });
                setAnchorEl(null);
              }}
            >
              This Week
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                const now = new Date();
                applyRange({
                  startDate: `${now.getFullYear()}-${padDatePart(now.getMonth() + 1)}-01`,
                  endDate: toDateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
                });
                setAnchorEl(null);
              }}
            >
              This Month
            </Button>
          </Stack>

          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Button
              size="small"
              onClick={() => {
                applyRange({ startDate: "", endDate: "" });
                setAnchorEl(null);
              }}
            >
              Clear
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                applyRange({ startDate: draftStart, endDate: draftEnd });
                setAnchorEl(null);
              }}
            >
              Apply
            </Button>
          </Box>
        </Stack>
      </Popover>
    </>
  );
}
