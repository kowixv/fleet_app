import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Node.js runtime (stable since Next.js 15.5) instead of the default Edge
  // Runtime — avoids a class of Edge-specific middleware invocation crashes
  // (MIDDLEWARE_INVOCATION_FAILED with no application-level stack trace) and
  // keeps middleware on the same runtime as the rest of our server code.
  runtime: "nodejs",
  matcher: [
    /*
     * Match all paths except static assets, the Telegram/cron/tracking API
     * routes (which authenticate themselves with their own secrets), and the
     * public /drive driver page (tablet-token auth, no app session).
     */
    "/((?!_next/static|_next/image|favicon.ico|api/telegram|api/cron|api/tracking|drive|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
