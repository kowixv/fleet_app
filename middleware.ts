import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and the Telegram/cron API routes,
     * which authenticate themselves with their own secrets.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/telegram|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
