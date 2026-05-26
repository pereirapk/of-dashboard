"use client";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";

export function SignInWithCumbuca() {
  return (
    <Button onClick={() => signIn("keycloak", { redirectTo: "/" })}>
      Entrar com Cumbuca
    </Button>
  );
}
