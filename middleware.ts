import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets, the Telegram/cron/tracking API
     * routes (which authenticate themselves with their own secrets), and the
     * public /drive driver page (tablet-token auth, no app session).
     */
    "/((?!_next/static|_next/image|favicon.ico|api/telegram|api/cron|api/tracking|drive|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
