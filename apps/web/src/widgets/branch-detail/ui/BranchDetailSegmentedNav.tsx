import { Box, Tab, Tabs } from "@mui/material";

export function BranchDetailSegmentedNav(props: {
  value: "queue" | "pickers" | "log";
  onChange: (value: "queue" | "pickers" | "log") => void;
}) {
  return (
    <Box
      sx={{
        borderRadius: 1.8,
        border: "1px solid rgba(148,163,184,0.14)",
        bgcolor: "rgba(248,250,252,0.94)",
        p: 0.35,
        boxShadow: "0 7px 16px rgba(15,23,42,0.05)",
      }}
    >
      <Tabs
        value={props.value}
        onChange={(_event, value) => props.onChange(value)}
        variant="fullWidth"
        sx={{
          minHeight: 36,
          "& .MuiTabs-indicator": {
            display: "none",
          },
          "& .MuiTab-root": {
            minHeight: 36,
            borderRadius: 1.5,
            fontWeight: 900,
            fontSize: { xs: 11, sm: 12 },
            textTransform: "none",
            color: "#475569",
            transition: "background-color 160ms ease, color 160ms ease, box-shadow 160ms ease",
          },
          "& .Mui-selected": {
            bgcolor: "white",
            color: "#0f172a !important",
            boxShadow: "0 5px 12px rgba(15,23,42,0.08)",
          },
        }}
      >
        <Tab value="queue" label="Queue" />
        <Tab value="pickers" label="Pickers" />
        <Tab value="log" label="Log" />
      </Tabs>
    </Box>
  );
}
