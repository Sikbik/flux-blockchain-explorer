import { NextRequest, NextResponse } from "next/server";
import { FluxAPI, FluxAPIError } from "@/lib/api/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: {
    hashOrHeight: string;
  };
};

function getBooleanParam(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const identifier = params.hashOrHeight;
  const searchParams = request.nextUrl.searchParams;
  const wantsRaw = getBooleanParam(searchParams.get("raw"));
  const wantsSummary = getBooleanParam(searchParams.get("summary"));

  try {
    if (wantsRaw) {
      const rawBlock = await FluxAPI.getRawBlock(identifier);
      return NextResponse.json(rawBlock);
    }

    if (wantsSummary) {
      const height = Number(identifier);
      if (!Number.isFinite(height)) {
        return NextResponse.json(
          { error: "summary mode requires a numeric block height" },
          { status: 400 }
        );
      }

      const summary = await FluxAPI.getBlockIndex(height);
      return NextResponse.json(summary);
    }

    const block = await FluxAPI.getBlock(identifier);
    return NextResponse.json(block);
  } catch (error) {
    const statusCode =
      error instanceof FluxAPIError
        ? error.statusCode ?? 500
        : 500;
    const message =
      error instanceof FluxAPIError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown error";

    return NextResponse.json(
      { error: message },
      { status: statusCode }
    );
  }
}
