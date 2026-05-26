import { SyncNowButton } from "@/components/sync/SyncNowButton";

export function Topbar({
  title,
  userEmail,
}: {
  title: string;
  userEmail?: string | null;
}) {
  return (
    <header className="border-b border-foreground/10 px-6 py-3 flex items-center justify-between gap-4 bg-foreground/[0.02]">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="flex items-center gap-4">
        <SyncNowButton />
        {userEmail && (
          <div
            className="size-8 rounded-full bg-foreground/10 flex items-center justify-center text-xs font-medium uppercase shrink-0"
            title={userEmail}
            aria-label={userEmail}
          >
            {userEmail.slice(0, 2)}
          </div>
        )}
      </div>
    </header>
  );
}
