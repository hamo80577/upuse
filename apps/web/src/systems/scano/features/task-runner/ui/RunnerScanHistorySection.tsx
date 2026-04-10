import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import type { ScanoTaskScansPageResponse } from "../../../api/types";
import { formatCairoFullDateTime } from "../../../pages/scano/ui/scanoShared";

export function RunnerScanHistorySection(props: {
  closeScanHistory: () => void;
  loadScanHistory: (page?: number) => Promise<void>;
  scanHistoryLoading: boolean;
  scanHistoryOpen: boolean;
  scansPage: ScanoTaskScansPageResponse;
  setScanHistoryOpen: (value: boolean) => void;
}) {
  return (
    <Card sx={{ borderRadius: 4 }}>
      <CardContent sx={{ p: 2 }}>
        <Stack spacing={1.3}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900 }}>
                Raw Scan History
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Duplicate blocks and saved products appear here after the lookup flow finishes.
              </Typography>
            </Box>
            <Button
              size="small"
              onClick={() => {
                if (props.scanHistoryOpen) {
                  props.closeScanHistory();
                  return;
                }
                props.setScanHistoryOpen(true);
              }}
            >
              {props.scanHistoryOpen ? "Hide" : "Show"}
            </Button>
          </Stack>

          {props.scanHistoryOpen ? (
            <>
              {props.scanHistoryLoading && !props.scansPage.items.length ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={18} />
                  <Typography variant="body2">Loading raw scan history...</Typography>
                </Stack>
              ) : null}

              {!props.scanHistoryLoading && !props.scansPage.items.length ? (
                <Alert severity="info" variant="outlined">
                  No raw scan attempts were recorded.
                </Alert>
              ) : null}

              {props.scansPage.items.map((scan) => (
                <Card key={scan.id} variant="outlined" sx={{ borderRadius: 3 }}>
                  <CardContent sx={{ p: 1.4 }}>
                    <Stack spacing={0.4}>
                      <Typography sx={{ fontWeight: 800 }}>{scan.barcode}</Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {scan.scannedBy.name} · {scan.source} · {scan.outcome ?? scan.lookupStatus ?? "captured"}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {formatCairoFullDateTime(scan.scannedAt)}
                      </Typography>
                    </Stack>
                  </CardContent>
                </Card>
              ))}

              {props.scansPage.items.length ? (
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Page {props.scansPage.page} of {props.scansPage.totalPages}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" disabled={props.scanHistoryLoading || props.scansPage.page <= 1} onClick={() => void props.loadScanHistory(props.scansPage.page - 1)}>
                      Previous
                    </Button>
                    <Button size="small" disabled={props.scanHistoryLoading || props.scansPage.page >= props.scansPage.totalPages} onClick={() => void props.loadScanHistory(props.scansPage.page + 1)}>
                      Next
                    </Button>
                  </Stack>
                </Stack>
              ) : null}
            </>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
