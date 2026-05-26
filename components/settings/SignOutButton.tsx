"use client";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  return (
    <Button
      variant="secondary"
      onClick={() => signOut({ redirectTo: "/login" })}
    >
      Sair
    </Button>
  );
}
