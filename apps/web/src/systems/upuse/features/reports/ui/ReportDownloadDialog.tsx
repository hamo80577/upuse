import AssessmentRoundedIcon from "@mui/icons-material/AssessmentRounded";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { api } from "../../../api/client";

type ReportPreset = "today" | "yesterday" | "last7" | "last30" | "day";

const presetOptions: Array<{ id: ReportPreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 Days" },
  { id: "last30", label: "Last 30 Days" },
  { id: "day", label: "Specific Day" },
];

function defaultDayValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function ReportDownloadDialog(props: {
  open: boolean;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState<ReportPreset>("today");
  const [day, setDay] = useState(defaultDayValue);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDownload = useMemo(
    () => preset !== "day" || Boolean(day),
    [day, preset],
  );

  const download = async () => {
    if (!canDownload || downloading) return;

    try {
      setDownloading(true);
      setError(null);
      const result = await api.downloadMonitorReport({ preset, day: preset === "day" ? day : undefined });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      props.onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to download report");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography sx={{ fontWeight: 900, lineHeight: 1.1 }}>
          Download Report
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={1.4}>
          <TextField
            select
            label="Report Range"
            value={preset}
            onChange={(event) => setPreset(event.target.value as ReportPreset)}
            fullWidth
          >
            {presetOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Specific Day"
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            disabled={preset !== "day"}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />

          {error ? (
            <Typography variant="caption" sx={{ color: "#b91c1c" }}>
              {error}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.2, pt: 1 }}>
        <Button onClick={props.onClose} disabled={downloading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={<AssessmentRoundedIcon />}
          onClick={download}
          disabled={!canDownload || downloading}
        >
          {downloading ? "Preparing..." : "Download CSV"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
