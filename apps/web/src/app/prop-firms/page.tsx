import { redirect } from "next/navigation";

/**
 * The built-in prop tracker is retired in Moria.
 *
 * Accounts, firm rules and payouts have exactly one owner — Trading Manager
 * Pro — and /campaign renders them. The journal's own prop tables are left in
 * place and empty so no data is destroyed.
 *
 * next.config's redirects() handles this route with a real 308 before any
 * rendering happens, so this component is only a backstop for the case where
 * a request somehow reaches it.
 */
export const dynamic = "force-dynamic";

export default function PropFirmsPage() {
  redirect("/campaign");
}
