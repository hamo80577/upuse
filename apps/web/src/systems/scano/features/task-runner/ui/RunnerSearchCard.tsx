import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import QrCodeScannerRoundedIcon from "@mui/icons-material/QrCodeScannerRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { RefObject } from "react";

export function RunnerSearchCard(props: {
  barcodeInput: string;
  cameraActionDisabled: boolean;
  cameraError: string;
  cameraLoading: boolean;
  cameraOpen: boolean;
  cameraPreviewVisible: boolean;
  cameraToggleLabel: string;
  onBarcodeInputChange: (value: string) => void;
  onSubmit: () => void;
  onToggleCamera: () => void;
  resolvingScan: boolean;
  runnerBootstrapError: string;
  runnerBootstrapLoading: boolean;
  searchDisabled: boolean;
  showSearchCard: boolean;
  showStartAction: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  if (!props.showSearchCard) {
    return (
      <Alert severity={props.showStartAction ? "info" : "warning"} variant="outlined">
        {props.showStartAction
          ? "Start the task first to enable barcode search."
          : "You can no longer scan products in this task."}
      </Alert>
    );
  }

  return (
    <Card
      sx={{
        borderRadius: 2.4,
        overflow: "hidden",
        border: "1px solid rgba(186,230,253,0.96)",
        bgcolor: "rgba(255,255,255,0.95)",
        boxShadow: "0 22px 42px rgba(125,211,252,0.18)",
      }}
    >
      <CardContent sx={{ p: { xs: 1.1, sm: 1.5 } }}>
        <Stack spacing={1.1}>
          {props.runnerBootstrapLoading ? (
            <Alert severity="info" variant="outlined">
              Preparing fast barcode lookup...
            </Alert>
          ) : null}

          {props.runnerBootstrapError ? (
            <Alert severity="error" variant="outlined">
              {props.runnerBootstrapError}
            </Alert>
          ) : null}

          <Stack
            component="form"
            spacing={1.2}
            onSubmit={(event) => {
              event.preventDefault();
              props.onSubmit();
            }}
            sx={{
              p: { xs: 1.15, sm: 1.25 },
              borderRadius: 2.1,
              bgcolor: "rgba(248,252,255,0.98)",
              border: "1px solid rgba(186,230,253,0.94)",
              boxShadow: "0 16px 30px rgba(186,230,253,0.2)",
              backdropFilter: "blur(16px)",
            }}
          >
            <Typography
              variant="overline"
              sx={{
                color: "#7399bf",
                fontWeight: 900,
                letterSpacing: "0.16em",
              }}
            >
              Search Focus
            </Typography>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                fullWidth
                label="Barcode"
                placeholder="Type or scan barcode here"
                value={props.barcodeInput}
                disabled={props.searchDisabled}
                onChange={(event) => props.onBarcodeInputChange(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <QrCode2RoundedIcon sx={{ color: "#6e9bc5" }} />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={props.cameraToggleLabel}
                        onClick={props.onToggleCamera}
                        edge="end"
                        type="button"
                        disabled={props.cameraActionDisabled}
                        sx={{
                          width: 40,
                          height: 40,
                          bgcolor: props.cameraOpen ? "rgba(186,230,253,0.5)" : "transparent",
                        }}
                      >
                        {props.cameraLoading ? <CircularProgress size={18} /> : <QrCodeScannerRoundedIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                type="submit"
                variant="contained"
                size="small"
                disabled={props.searchDisabled || !props.barcodeInput.trim()}
                startIcon={props.resolvingScan ? <CircularProgress size={16} color="inherit" /> : <SearchRoundedIcon />}
                sx={{
                  minWidth: { xs: "100%", sm: 138 },
                  borderRadius: 2,
                  fontWeight: 900,
                  boxShadow: "none",
                }}
              >
                Find Product
              </Button>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "#6f8ea9" }}>
              <QrCodeScannerRoundedIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                Align the barcode inside the frame
              </Typography>
            </Stack>
          </Stack>

          <Box sx={{ display: props.cameraPreviewVisible ? "block" : "none" }}>
            <Card
              sx={{
                borderRadius: 2.25,
                overflow: "hidden",
                bgcolor: "#081522",
                color: "#f8fbff",
                boxShadow: "0 22px 50px rgba(8,21,34,0.3)",
              }}
            >
              <CardContent sx={{ p: 1.2 }}>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography sx={{ fontWeight: 900 }}>
                      Camera Scanner
                    </Typography>
                    <Button size="small" color="inherit" type="button" onClick={props.onToggleCamera}>
                      {props.cameraOpen ? "Stop Camera" : "Close"}
                    </Button>
                  </Stack>

                  <Box
                    sx={{
                      position: "relative",
                      borderRadius: 2,
                      overflow: "hidden",
                      minHeight: { xs: 260, sm: 320 },
                      bgcolor: "#06101a",
                      border: "1px solid rgba(148,196,240,0.24)",
                    }}
                  >
                    <Box
                      component="video"
                      ref={props.videoRef}
                      autoPlay
                      muted
                      playsInline
                      sx={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />

                    <Box
                      sx={{
                        position: "absolute",
                        inset: "18% 8%",
                        borderRadius: 3,
                        border: "2px solid rgba(186,230,253,0.92)",
                        boxShadow: "0 0 0 999px rgba(8,21,34,0.42)",
                        pointerEvents: "none",
                      }}
                    />

                    <Stack
                      spacing={0.35}
                      sx={{
                        position: "absolute",
                        left: 16,
                        bottom: 16,
                        px: 1.1,
                        py: 0.75,
                        borderRadius: 2,
                        bgcolor: "rgba(8,21,34,0.7)",
                        backdropFilter: "blur(14px)",
                      }}
                    >
                      <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em" }}>
                        SEARCH WINDOW
                      </Typography>
                      <Typography sx={{ fontSize: 11.5, fontWeight: 700, lineHeight: 1.1 }}>
                        The scanner focuses on the center barcode area.
                      </Typography>
                    </Stack>

                    {props.cameraLoading ? (
                      <Stack
                        spacing={1}
                        alignItems="center"
                        justifyContent="center"
                        sx={{
                          position: "absolute",
                          inset: 0,
                          bgcolor: "rgba(239,248,255,0.7)",
                          color: "#7aa5c8",
                        }}
                      >
                        <CircularProgress size={28} />
                        <Typography sx={{ fontWeight: 800 }}>
                          Opening camera...
                        </Typography>
                      </Stack>
                    ) : null}
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Box>

          {props.cameraError ? (
            <Alert severity="warning" variant="outlined">
              {props.cameraError}
            </Alert>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
