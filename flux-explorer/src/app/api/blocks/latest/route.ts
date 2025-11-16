import { NextRequest, NextResponse } from "next/server";
import { FluxAPI, FluxAPIError } from "@/lib/api/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limitParam = searchParams.get("limit");

  let limit = 10;
  if (limitParam) {
    const parsed = Number(limitParam);
    if (Number.isFinite(parsed)) {
      limit = Math.max(1, Math.min(Math.floor(parsed), 50));
    }
  }

  try {
    const blocks = await FluxAPI.getLatestBlocks(limit);
    return NextResponse.json(blocks);
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
