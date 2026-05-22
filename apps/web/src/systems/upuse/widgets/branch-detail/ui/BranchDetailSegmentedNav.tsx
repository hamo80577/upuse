import { Box, Tab, Tabs } from "@mui/material";

export function BranchDetailSegmentedNav(props: {
  value: "queue" | "pickers" | "log";
  onChange: (value: "queue" | "pickers" | "log") => void;
}) {
  return (
    <Box
      sx={{
        borderRadius: 2.3,
        border: "1px solid rgba(148,163,184,0.16)",
        bgcolor: "rgba(255,255,255,0.92)",
        p: 0.45,
        boxShadow: "0 12px 24px rgba(15,23,42,0.065)",
      }}
    >
      <Tabs
        value={props.value}
        onChange={(_event, value) => props.onChange(value)}
        variant="fullWidth"
        sx={{
          minHeight: 42,
          "& .MuiTabs-indicator": {
            display: "none",
          },
          "& .MuiTab-root": {
            minHeight: 42,
            borderRadius: 1.8,
            fontWeight: 900,
            fontSize: { xs: 12, sm: 13 },
            textTransform: "none",
            color: "#475569",
            transition: "background-color 160ms ease, color 160ms ease, box-shadow 160ms ease",
          },
          "& .Mui-selected": {
            bgcolor: "white",
            color: "#1d4ed8 !important",
            boxShadow: "0 8px 18px rgba(37,99,235,0.12)",
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
