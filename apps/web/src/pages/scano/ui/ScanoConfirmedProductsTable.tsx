import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { ScanoTaskProduct, ScanoTaskProductListSourceFilter } from "../../../api/types";
import { formatCairoFullDateTime, getScanoTaskProductSourceLabel } from "./scanoShared";

function ProductThumbnail(props: { product: ScanoTaskProduct }) {
  const image = props.product.images[0]
    ? { url: props.product.images[0].url, fileName: props.product.images[0].fileName }
    : props.product.previewImageUrl
      ? { url: props.product.previewImageUrl, fileName: props.product.itemNameEn }
      : null;
  return (
    <Box
      sx={{
        width: 60,
        height: 60,
        borderRadius: 2.5,
        bgcolor: "#ffffff",
        border: "1px solid rgba(148,163,184,0.22)",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
      }}
    >
      {image ? (
        <Box
          component="img"
          src={image.url}
          alt={props.product.itemNameEn}
          sx={{
            width: "78%",
            height: "78%",
            objectFit: "contain",
            display: "block",
            bgcolor: "#ffffff",
          }}
        />
      ) : (
        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700 }}>
          No image
        </Typography>
      )}
    </Box>
  );
}

export function ScanoConfirmedProductsTable(props: {
  title: string;
  items: ScanoTaskProduct[];
  loading: boolean;
  page: number;
  totalPages: number;
  total: number;
  query: string;
  sourceFilter: ScanoTaskProductListSourceFilter;
  emptyMessage: string;
  onQueryChange: (value: string) => void;
  onSourceFilterChange: (value: ScanoTaskProductListSourceFilter) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRowClick?: (product: ScanoTaskProduct) => void;
}) {
  return (
    <Stack spacing={1.3}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            {props.title}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {props.total} matching items
          </Typography>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <TextField
            size="small"
            label="Search"
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder="Barcode, SKU, ID, or name"
          />
          <TextField
            select
            size="small"
            label="Source"
            value={props.sourceFilter}
            onChange={(event) => props.onSourceFilterChange(event.target.value as ScanoTaskProductListSourceFilter)}
            sx={{ minWidth: 140 }}
          >
            {(["all", "vendor", "chain", "master", "manual"] as const).map((value) => (
              <MenuItem key={value} value={value}>
                {getScanoTaskProductSourceLabel(value)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Stack>

      {props.loading && !props.items.length ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Loading products...</Typography>
        </Stack>
      ) : null}

      {!props.loading && !props.items.length ? (
        <Alert severity="info" variant="outlined">
          {props.emptyMessage}
        </Alert>
      ) : null}

      {props.items.length ? (
        <>
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Image</TableCell>
                  <TableCell>Item Name</TableCell>
                  <TableCell>Barcode</TableCell>
                  <TableCell>SKU</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Added By</TableCell>
                  <TableCell>Confirmed At</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {props.items.map((product) => (
                  <TableRow
                    key={product.id}
                    hover={!!props.onRowClick}
                    onClick={props.onRowClick ? () => props.onRowClick?.(product) : undefined}
                    sx={{
                      cursor: props.onRowClick ? "pointer" : "default",
                      "& td": {
                        py: 1.1,
                      },
                    }}
                  >
                    <TableCell sx={{ width: 76 }}>
                      <ProductThumbnail product={product} />
                    </TableCell>
                    <TableCell>
                      <Stack spacing={0.3}>
                        <Typography sx={{ fontWeight: 800 }}>{product.itemNameEn}</Typography>
                        {product.itemNameAr ? (
                          <Typography variant="caption" sx={{ color: "text.secondary" }}>
                            {product.itemNameAr}
                          </Typography>
                        ) : null}
                      </Stack>
                    </TableCell>
                    <TableCell>{product.barcode}</TableCell>
                    <TableCell>{product.sku}</TableCell>
                    <TableCell>{getScanoTaskProductSourceLabel(product.sourceType)}</TableCell>
                    <TableCell>{product.createdBy.name}</TableCell>
                    <TableCell>{formatCairoFullDateTime(product.confirmedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Page {props.page} of {props.totalPages}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={props.onPrevious} disabled={props.loading || props.page <= 1}>
                Previous
              </Button>
              <Button size="small" onClick={props.onNext} disabled={props.loading || props.page >= props.totalPages}>
                Next
              </Button>
            </Stack>
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}
