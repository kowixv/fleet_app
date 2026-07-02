import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refreshes the Supabase session cookie and guards app routes. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const path = request.nextUrl.pathname;
    const isAuthRoute = path.startsWith("/login");

    if (!user && !isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    if (user && isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    return response;
  } catch (err) {
    // The session check crashed — a corrupt/oversized auth cookie, a Supabase
    // network hiccup, or a transient platform issue can all throw here, and
    // previously that meant a bare 500 (MIDDLEWARE_INVOCATION_FAILED) with no
    // trace in the logs. Fail safe instead: log the real error so it's
    // diagnosable next time, drop whatever Supabase auth cookies might be the
    // culprit, and send the user to /login rather than crashing the request.
    console.error("middleware: session check failed", err);

    const path = request.nextUrl.pathname;
    if (path.startsWith("/login")) {
      return NextResponse.next({ request });
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const fallback = NextResponse.redirect(url);
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith("sb-")) {
        fallback.cookies.delete(cookie.name);
      }
    }
    return fallback;
  }
}
