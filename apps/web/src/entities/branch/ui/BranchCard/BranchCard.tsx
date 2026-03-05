import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import { memo, useEffect, useState } from "react";
import type { BranchSnapshot } from "../../../../api/types";
import { fmtInt } from "../../../../utils/format";
import { BranchCardMetrics } from "./BranchCardMetrics";
import { BranchCardStatus } from "./BranchCardStatus";
import { rankMeta, resolveClosureUiState } from "./branchCardViewModel";

function BranchCardBase(props: {
  b: BranchSnapshot;
  rank?: number;
  onOpenDetail: (branchId: number) => void;
}) {
  const { b } = props;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!(b.status === "TEMP_CLOSE" && b.closedUntil)) return;

    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [b.closedUntil, b.status]);

  const closureUi = resolveClosureUiState(b, nowMs);
  const rank = props.rank ?? 0;
  const rankStyle = rankMeta(rank);
  const openDetail = () => props.onOpenDetail(b.branchId);

  return (
    <Card
      onClick={openDetail}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetail();
        }
      }}
      role="button"
      tabIndex={0}
      sx={{
        width: "100%",
        borderRadius: "18px",
        cursor: "pointer",
        border: closureUi.isTempClosed ? "1px solid rgba(220,38,38,0.22)" : "1px solid rgba(148,163,184,0.14)",
        boxShadow: closureUi.isTempClosed
          ? "0 10px 22px rgba(220,38,38,0.06), 0 2px 8px rgba(220,38,38,0.04)"
          : "0 14px 32px rgba(15,23,42,0.06), 0 3px 10px rgba(15,23,42,0.04)",
        background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
        transition: "box-shadow 180ms ease, border-color 180ms ease",
        "&:hover": {
          boxShadow: closureUi.isTempClosed
            ? "0 12px 24px rgba(220,38,38,0.08), 0 3px 10px rgba(220,38,38,0.05)"
            : "0 18px 34px rgba(15,23,42,0.08), 0 4px 12px rgba(15,23,42,0.05)",
          borderColor: closureUi.isTempClosed ? "rgba(220,38,38,0.24)" : "rgba(100,116,139,0.20)",
        },
        "&:focus-visible": {
          outline: "2px solid rgba(37,99,235,0.24)",
          outlineOffset: 3,
        },
      }}
    >
      <CardContent sx={{ p: { xs: 1.35, md: 1.65 }, "&:last-child": { pb: { xs: 1.35, md: 1.65 } } }}>
        <Box
          sx={{
            display: "grid",
            gap: { xs: 1, lg: 1.4 },
            alignItems: "center",
            gridTemplateColumns: {
              xs: "52px minmax(0, 1fr)",
              lg: "60px minmax(0, 1fr)",
            },
          }}
        >
          <Box
            sx={{
              minWidth: 0,
              alignSelf: "stretch",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pr: { xs: 0.4, md: 0.55 },
            }}
          >
            <Box
              sx={{
                width: "100%",
                minHeight: "100%",
                py: 0.6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRight: "1px solid rgba(148,163,184,0.12)",
                bgcolor: rankStyle.panelBg,
                position: "relative",
                "&::after": {
                  content: '""',
                  position: "absolute",
                  right: 0,
                  top: "22%",
                  bottom: "22%",
                  width: 2,
                  borderRadius: 999,
                  bgcolor: rankStyle.railColor,
                  opacity: 0.65,
                },
              }}
            >
              <Typography
                sx={{
                  color: rankStyle.textColor,
                  fontWeight: 900,
                  fontSize: { xs: 18, md: 20 },
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: -0.3,
                }}
              >
                {fmtInt(rank)}
              </Typography>
            </Box>
          </Box>

          <Box
            sx={{
              display: "grid",
              gap: { xs: 1.1, lg: 1.6 },
              alignItems: "center",
              gridTemplateColumns: {
                xs: "1fr",
                lg: "360px minmax(0, 2.8fr) 190px",
                xl: "400px minmax(0, 2.7fr) 210px",
              },
            }}
          >
            <Stack spacing={1.1} sx={{ minWidth: 0, pr: { lg: 1 } }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 900,
                    lineHeight: 1.18,
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                  }}
                >
                  {b.name}
                </Typography>
              </Box>
            </Stack>

            <BranchCardMetrics metrics={b.metrics} />

            <BranchCardStatus
              branch={b}
              nowMs={nowMs}
              progressValue={closureUi.progressValue}
              canTrackProgress={closureUi.canTrackProgress}
              timerReached={closureUi.timerReached}
            />
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export const BranchCard = memo(BranchCardBase);
