import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onIdTokenChanged, signOut as fbSignOut, type User } from "@firebase/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PERMISSIONS, SYSTEM_ROLES, type MeDto } from "@easytenant/shared";
import { auth } from "../lib/firebase";
import { api } from "../lib/api";

export interface Capabilities {
  manager: boolean;
  platformAdmin: boolean;
  createDevelopment: boolean;
  technician: boolean;
  tenant: boolean;
  approveCost: boolean;
  hasAnyRole: boolean;
}

interface AuthValue {
  firebaseUser: User | null;
  loading: boolean;
  me: MeDto | undefined;
  caps: Capabilities;
  emailVerified: boolean;
  /** Re-reads the Firebase user and forces a fresh token, so the API sees
   * email_verified as soon as the person clicks the link. */
  refreshVerification: () => Promise<boolean>;
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

function capabilitiesOf(me: MeDto | undefined): Capabilities {
  const roles = me?.roles ?? [];
  const has = (p: string) => roles.some((r) => r.permissions.includes(p as never));
  const platform = new Set<string>(me?.platformPermissions ?? []);
  return {
    manager: has(PERMISSIONS.ISSUE_VIEW_ALL),
    platformAdmin: platform.has(PERMISSIONS.ROLE_MANAGE),
    createDevelopment: platform.has(PERMISSIONS.DEVELOPMENT_CREATE),
    technician: roles.some((r) => r.roleName === SYSTEM_ROLES.SERVICE_PERSONNEL),
    tenant: roles.some((r) => r.roleName === SYSTEM_ROLES.TENANT),
    approveCost: has(PERMISSIONS.ISSUE_APPROVE_COST),
    hasAnyRole: roles.length > 0,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [firebaseUser, setFirebaseUser] = useState<User | null | undefined>(undefined);
  const [emailVerified, setEmailVerified] = useState(false);

  useEffect(
    () =>
      onIdTokenChanged(auth, (u) => {
        setFirebaseUser(u);
        setEmailVerified(Boolean(u?.emailVerified));
        if (!u) qc.clear();
      }),
    [qc]
  );

  const meQuery = useQuery({
    queryKey: ["me", firebaseUser?.uid],
    enabled: Boolean(firebaseUser),
    queryFn: async () => {
      await api("/api/me/sync", { method: "POST" });
      return api<MeDto>("/api/me");
    },
    staleTime: 60_000,
  });

  const refreshVerification = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return false;
    await u.reload();
    if (u.emailVerified) await u.getIdToken(true);
    setEmailVerified(u.emailVerified);
    if (u.emailVerified) await qc.invalidateQueries({ queryKey: ["me"] });
    return u.emailVerified;
  }, [qc]);

  const value = useMemo<AuthValue>(
    () => ({
      firebaseUser: firebaseUser ?? null,
      loading: firebaseUser === undefined || (Boolean(firebaseUser) && meQuery.isPending),
      me: meQuery.data,
      caps: capabilitiesOf(meQuery.data),
      emailVerified,
      refreshVerification,
      refreshMe: async () => {
        await qc.invalidateQueries({ queryKey: ["me"] });
      },
      signOut: async () => {
        await fbSignOut(auth);
        qc.clear();
      },
    }),
    [firebaseUser, meQuery.data, meQuery.isPending, emailVerified, refreshVerification, qc]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
