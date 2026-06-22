"use client";

import { useActionState, useState } from "react";
import { signIn, signUp } from "./actions";

const initial = { error: "" } as { error?: string };

export default function LoginPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const action = mode === "in" ? signIn : signUp;
  const [state, formAction] = useActionState(action as any, initial);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <h1 className="text-xl font-bold text-brand">Fleet Settlement</h1>
        <p className="mb-5 mt-1 text-sm text-slate-500">
          {mode === "in" ? "Giriş yap" : "Hesap oluştur"}
        </p>
        <form action={formAction} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" required className="input" />
          </div>
          <div>
            <label className="label">Şifre</label>
            <input
              name="password"
              type="password"
              required
              minLength={6}
              className="input"
            />
          </div>
          {state?.error ? (
            <p className="text-sm text-red-600">{state.error}</p>
          ) : null}
          <button type="submit" className="btn-primary w-full">
            {mode === "in" ? "Giriş" : "Kayıt ol"}
          </button>
        </form>
        <button
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-4 text-sm text-brand hover:underline"
        >
          {mode === "in"
            ? "Hesabın yok mu? Kayıt ol"
            : "Zaten hesabın var mı? Giriş yap"}
        </button>
      </div>
    </div>
  );
}
