"use client";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";

/**
 * Re-triggers the Keycloak OAuth flow. We deliberately do NOT pass
 * `prompt=consent` because the Cumbuca Keycloak realm treats DCR-registered
 * clients as federated brokers, and `prompt=consent` triggers a "First Broker
 * Login" link flow that requires a password the typical Cumbuca user does
 * not have (they auth via PIN / biometric / magic link in the Cumbuca app).
 */
export function ConnectCumbucaButton() {
  return (
    <Button onClick={() => signIn("keycloak", { redirectTo: "/" })}>
      Conectar Open Finance Cumbuca
    </Button>
  );
}
