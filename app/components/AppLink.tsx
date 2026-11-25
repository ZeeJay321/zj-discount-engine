import type { ReactNode } from "react";
import { useNavigate } from "react-router";

/**
 * In-app link for the embedded admin. A plain href inside the Shopify admin iframe
 * does a full document load without App Bridge's session context, which leaves a
 * blank page; React Router navigation keeps the session (App Bridge adds the token
 * to the data request). The href stays for hover/accessibility.
 */
export function AppLink({ to, children, id }: { to: string; children: ReactNode; id?: string }) {
  const navigate = useNavigate();
  return (
    <s-link
      {...(id ? { id } : {})}
      href={to}
      onClick={(event: { preventDefault: () => void }) => {
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </s-link>
  );
}

/** Button that navigates inside the app (same reason as AppLink). */
export function useAppNavigate() {
  const navigate = useNavigate();
  return (to: string) => navigate(to);
}
