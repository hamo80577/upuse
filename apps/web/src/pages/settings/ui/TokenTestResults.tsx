import { Alert, Box, Skeleton, Stack, Typography } from "@mui/material";
import type { SettingsTokenTestSnapshot } from "../../../api/types";

interface TokenTestResultsProps {
    test: SettingsTokenTestSnapshot | null;
    isLoading: boolean;
}

export function TokenTestResults({ test, isLoading }: TokenTestResultsProps) {
    if (!isLoading && !test) {
        return null;
    }

    if (isLoading && !test) {
        return (
            <Box sx={{ mt: 2 }}>
                <Stack spacing={1}>
                    <Skeleton variant="rounded" height={56} />
                    <Skeleton variant="rounded" height={40} />
                    <Skeleton variant="rounded" height={40} />
                </Stack>
            </Box>
        );
    }

    if (!test) {
        return null;
    }

    return (
        <Box sx={{ mt: 2 }}>
            <Stack spacing={1}>
                <Alert severity={test.status === "failed" ? "error" : test.status === "completed" ? "success" : "info"}>
                    <Typography sx={{ fontWeight: 700 }}>
                        Token Test Job: {test.status} • {test.progress.processedBranches}/{test.progress.totalBranches} branches • {test.progress.percent}%
                    </Typography>
                </Alert>
                <Alert severity={test.availability.ok ? "success" : test.availability.configured ? "error" : "warning"}>
                    Availability Token: {test.availability.ok ? "OK" : test.availability.message || `Failed${test.availability.status ? ` (HTTP ${test.availability.status})` : ""}`}
                </Alert>
                <Alert severity={test.orders.configValid ? "success" : "warning"}>
                    Orders Config: {test.orders.configValid ? "Ready for branch checks" : test.orders.configMessage || "Configuration incomplete"}
                </Alert>
                {test.orders.probe ? (
                    <Alert severity={test.orders.probe.ok ? "success" : test.orders.probe.configured ? "warning" : "warning"}>
                        Orders Probe: {test.orders.probe.ok ? "OK" : test.orders.probe.message || `Failed${test.orders.probe.status ? ` (HTTP ${test.orders.probe.status})` : ""}`}
                    </Alert>
                ) : null}
                <Alert severity={test.orders.ok ? "success" : test.orders.failedBranchCount > 0 ? "warning" : "info"}>
                    Orders Branch Sweep: {test.orders.passedBranchCount}/{test.orders.enabledBranchCount} enabled branches passed
                    {test.orders.failedBranchCount > 0 ? `, ${test.orders.failedBranchCount} failed` : ""}
                </Alert>
                {test.orders.branches.length > 0 && (
                    <Stack spacing={0.75}>
                        {test.orders.branches.map((branch) => (
                            <Alert key={branch.branchId} severity={branch.ok ? "success" : "error"} variant={branch.ok ? "outlined" : "filled"}>
                                {branch.name} ({branch.ordersVendorId}): {branch.ok ? branch.sampleVendorName || branch.message || "Token OK" : branch.message || `Failed${branch.status ? ` (HTTP ${branch.status})` : ""}`}
                            </Alert>
                        ))}
                    </Stack>
                )}
            </Stack>
        </Box>
    );
}