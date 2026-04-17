import { NextResponse } from 'next/server';
import { withWorkspace, type WorkspaceContext } from './context';

// Convenience wrapper for App Router route handlers that returns a standard
// JSON "no workspace selected" 400 when there is no workspace in the request
// or registry. Keeps individual route handlers from having to re-check.
export async function withWorkspaceRoute<T>(
  req: Request,
  handler: (ctx: WorkspaceContext) => Promise<NextResponse<T> | Response>
): Promise<NextResponse | Response> {
  return withWorkspace(req, async (ctx) => {
    if (!ctx) {
      return NextResponse.json(
        {
          error: {
            code: 'no-workspace',
            message:
              'No Bird Brain workspace is active. Pick or add a workspace from the home screen.',
          },
        },
        { status: 400 }
      );
    }
    return handler(ctx);
  });
}
