import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ROLE_LABEL, type InvitePreviewDto } from "@easytenant/shared";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../auth/AuthProvider";
import { Button, ButtonLink, ErrorNote, Spinner, UnitPlate } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { AuthLayout } from "./AuthLayout";
import VerifyEmail from "./VerifyEmail";

export default function Join() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { firebaseUser, emailVerified, refreshMe, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useQuery({
    queryKey: ["invite", code],
    queryFn: () => api<InvitePreviewDto>(`/api/public/invites/${encodeURIComponent(code)}`),
    retry: false,
  });

  if (preview.isPending) return <AuthLayout title="Opening your invite"><Spinner /></AuthLayout>;
  if (preview.isError)
    return (
      <AuthLayout title="This invite can't be used" subtitle={errorMessage(preview.error)}>
        <p className="text-sm text-ink-2">Ask whoever invited you to send a new link.</p>
      </AuthLayout>
    );

  const inv = preview.data;
  const roleLabel = ROLE_LABEL[inv.role].toLowerCase();
  const back = `/join/${code}`;
  const emailParam = `next=${encodeURIComponent(back)}&email=${encodeURIComponent(inv.inviteeEmail)}`;
  const wrongAccount = firebaseUser && firebaseUser.email?.toLowerCase() !== inv.inviteeEmail;

  if (firebaseUser && !wrongAccount && !emailVerified) return <VerifyEmail />;

  return (
    <AuthLayout title={`Join ${inv.developmentName}`} subtitle={`You've been invited as ${roleLabel}.`}>
      <div className="mb-6 flex items-center gap-4 rounded-lg border border-line bg-panel p-4">
        {inv.unitLabel ? <UnitPlate>{inv.unitLabel}</UnitPlate> : null}
        <div className="min-w-0 text-sm">
          <div className="font-semibold">{inv.unitLabel ? `Unit ${inv.unitLabel}` : inv.developmentName}</div>
          <div className="truncate text-ink-2">For {inv.inviteeEmail}</div>
          <div className="text-ink-3">Expires {formatDate(inv.expiresAt)}</div>
        </div>
      </div>
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {!firebaseUser && (
        <div className="space-y-3">
          <ButtonLink to={`/signup?${emailParam}`} variant="primary" className="w-full">Create an account</ButtonLink>
          <ButtonLink to={`/signin?${emailParam}`} className="w-full">I already have an account</ButtonLink>
        </div>
      )}

      {wrongAccount && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            You're signed in as <strong className="text-ink">{firebaseUser.email}</strong>, but this invite is for <strong className="text-ink">{inv.inviteeEmail}</strong>.
          </p>
          <Button variant="primary" className="w-full" onClick={() => void signOut()}>Switch account</Button>
        </div>
      )}

      {firebaseUser && !wrongAccount && emailVerified && (
        <Button
          variant="primary"
          className="w-full"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/api/invites/${encodeURIComponent(code)}/accept`, { method: "POST" });
              await refreshMe();
              navigate("/", { replace: true });
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Accept invite
        </Button>
      )}
    </AuthLayout>
  );
}
