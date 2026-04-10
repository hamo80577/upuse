import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScanoTaskProductDraft } from "../../../api/types";
import { ScanoTaskProductDialog } from "./ScanoTaskProductDialog";

function createDraft(overrides?: Partial<ScanoTaskProductDraft>): ScanoTaskProductDraft {
  return {
    externalProductId: "EXT-30900149",
    previewImageUrl: "https://images.example.com/product.png",
    barcode: "0622300026348",
    barcodes: ["0622300026348", "062230002634899"],
    sku: "30900149",
    price: "208.95",
    itemNameEn: "Afia Corn Oil, 1.6L",
    itemNameAr: "عافية زيت ذرة ١.٦ لتر",
    chain: "yes",
    vendor: "yes",
    masterfile: "no",
    new: "no",
    sourceType: "vendor",
    images: ["https://images.example.com/product.png"],
    warning: null,
    ...overrides,
  };
}

describe("ScanoTaskProductDialog", () => {
  it("shows only the product ID below the title summary", () => {
    render(
      <ScanoTaskProductDialog
        open
        mode="draft"
        title="Review Product"
        value={createDraft()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Afia Corn Oil, 1.6L")).toBeInTheDocument();
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("EXT-30900149")).toBeInTheDocument();
    expect(screen.queryByText("0622300026348 · EXT-30900149 · 30900149 · 208.95")).not.toBeInTheDocument();
    expect(screen.queryByText("Tap image to expand")).not.toBeInTheDocument();
  });

  it("renders the hero product image inside the fixed container using the full container height", () => {
    render(
      <ScanoTaskProductDialog
        open
        mode="draft"
        title="Review Product"
        value={createDraft()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByAltText("Image 1")).toHaveStyle({
      height: "100%",
      width: "auto",
      maxWidth: "100%",
      maxHeight: "100%",
      objectFit: "contain",
      objectPosition: "center",
      display: "block",
    });
  });

  it("wraps long metadata values inside the product info cards", () => {
    const longBarcode = "062230002634806223000263480622300026348";
    const longArabicName = "اسم عربي طويل جدا جدا جدا لاختبار كسر النص داخل بطاقة البيانات بدون خروج المحتوى";

    render(
      <ScanoTaskProductDialog
        open
        mode="draft"
        title="Review Product"
        value={createDraft({
          barcode: longBarcode,
          barcodes: [longBarcode],
          itemNameAr: longArabicName,
        })}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getAllByText(longBarcode)[0]).toHaveStyle({
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });
    expect(screen.getAllByText(longArabicName)[0]).toHaveStyle({
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });
  });

  it("renders a preview fallback when an external draft has no detailed image gallery", () => {
    render(
      <ScanoTaskProductDialog
        open
        mode="draft"
        title="Review Product"
        value={createDraft({
          previewImageUrl: "https://images.example.com/product-fallback.png",
          images: [],
        })}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByAltText("Afia Corn Oil, 1.6L")).toBeInTheDocument();
  });

  it("highlights required manual fields before confirm", () => {
    const onSubmit = vi.fn();

    render(
      <ScanoTaskProductDialog
        open
        mode="draft"
        title="Review Product"
        value={createDraft({
          externalProductId: null,
          previewImageUrl: null,
          barcode: "",
          barcodes: [],
          sku: null,
          price: null,
          itemNameEn: null,
          itemNameAr: null,
          sourceType: "manual",
          chain: "no",
          vendor: "no",
          masterfile: "no",
          new: "yes",
          images: [],
        })}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(screen.getByText("Barcode is required.")).toBeInTheDocument();
    expect(screen.getByText("SKU is required.")).toBeInTheDocument();
    expect(screen.getByText("Price is required.")).toBeInTheDocument();
    expect(screen.getByText("English item name is required.")).toBeInTheDocument();
    expect(screen.getByText("Manual products need at least one image.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requires both image and price for master products before confirm", () => {
    const onSubmit = vi.fn();

    render(
      <ScanoTaskProductDialog
        open
        mode="draft"
        title="Review Product"
        value={createDraft({
          externalProductId: null,
          previewImageUrl: null,
          price: null,
          sourceType: "master",
          chain: "no",
          vendor: "no",
          masterfile: "yes",
          new: "no",
          images: [],
        })}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(screen.getByText("Price is required.")).toBeInTheDocument();
    expect(screen.getByText("Master products need at least one image.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
