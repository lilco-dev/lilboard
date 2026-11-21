import { requireAdmin } from "@/lib/auth";
import { listErrorResponse } from "@/lib/core";
import { registerListSchema } from "@/lib/lists";

export async function PUT(req: Request, { params }: { params: Promise<{ board: string; schema: string }> }) {
  const admin = requireAdmin(req, "schema registration");
  if (admin instanceof Response) return admin;
  const { board, schema } = await params;
  try {
    return Response.json({ id: schema, schema: registerListSchema(board, schema, await req.json().catch(() => null)) }, { status: 201 });
  } catch (error) {
    return listErrorResponse(error);
  }
}
