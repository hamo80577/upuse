import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import type { ScanoTaskProduct, ScanoTaskProductListSourceFilter, ScanoTaskProductsPageResponse } from "../../../api/types";
import { ScanoConfirmedProductsTable } from "../../../pages/scano/ui/ScanoConfirmedProductsTable";
import { LatestConfirmedProductCard } from "./RunnerSummaryCards";

export function RunnerConfirmedProductsSection(props: {
  confirmedProductsOpen: boolean;
  latestConfirmedProduct: ScanoTaskProduct | null;
  loadProductsPage: (page?: number) => Promise<void>;
  onOpenProduct: (product: ScanoTaskProduct) => void;
  page: ScanoTaskProductsPageResponse;
  productQuery: string;
  productSourceFilter: ScanoTaskProductListSourceFilter;
  productsLoading: boolean;
  setConfirmedProductsOpen: (next: boolean | ((current: boolean) => boolean)) => void;
  setProductQuery: (value: string) => void;
  setProductSourceFilter: (value: ScanoTaskProductListSourceFilter) => void;
}) {
  return (
    <Card sx={{ borderRadius: 4 }}>
      <CardContent sx={{ p: 2 }}>
        <Stack spacing={1.25}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900 }}>
                Confirmed Products
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {props.page.total} confirmed item{props.page.total === 1 ? "" : "s"}
              </Typography>
            </Box>
            <Button size="small" onClick={() => props.setConfirmedProductsOpen((current) => !current)}>
              {props.confirmedProductsOpen ? "Hide All" : "Show All"}
            </Button>
          </Stack>

          {props.latestConfirmedProduct ? (
            <LatestConfirmedProductCard
              product={props.latestConfirmedProduct}
              onOpen={() => props.onOpenProduct(props.latestConfirmedProduct!)}
            />
          ) : (
            <Alert severity="info" variant="outlined">
              No products were confirmed yet.
            </Alert>
          )}

          {props.confirmedProductsOpen ? (
            <ScanoConfirmedProductsTable
              title="All Confirmed Products"
              items={props.page.items}
              loading={props.productsLoading}
              page={props.page.page}
              totalPages={props.page.totalPages}
              total={props.page.total}
              query={props.productQuery}
              sourceFilter={props.productSourceFilter}
              emptyMessage="No products were confirmed yet."
              onQueryChange={props.setProductQuery}
              onSourceFilterChange={props.setProductSourceFilter}
              onPrevious={() => void props.loadProductsPage(props.page.page - 1)}
              onNext={() => void props.loadProductsPage(props.page.page + 1)}
              onRowClick={props.onOpenProduct}
            />
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
