import { useState } from "react";
import { sendEmailVerification } from "@firebase/auth";
import { MailCheck } from "lucide-react";
import { actionCodeSettings, auth, authErrorMessage } from "../../lib/firebase";
import { useAuth } from "../../auth/AuthProvider";
import { Button, ErrorNote } from "../../components/ui";
import { AuthLayout } from "./AuthLayout";

export default function VerifyEmail() {
  const { firebaseUser, refreshVerification, signOut } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "send" | null>(null);
  return (
    <AuthLayout title="Verify your email" subtitle={<>We sent a link to <strong className="text-ink">{firebaseUser?.email}</strong>. Open it to finish setting up.</>}>
      <div className="space-y-3">
        {error && <ErrorNote>{error}</ErrorNote>}
        {note && <p className="text-sm text-ink-2">{note}</p>}
        <Button
          variant="primary"
          className="w-full"
          icon={<MailCheck className="size-4" />}
          loading={busy === "check"}
          onClick={async () => {
            setBusy("check");
            setError(null);
            const ok = await refreshVerification().catch(() => false);
            if (!ok) setNote("Not verified yet. Open the link in the email, then try again.");
            setBusy(null);
          }}
        >
          I've verified my email
        </Button>
        <Button
          className="w-full"
          loading={busy === "send"}
          onClick={async () => {
            if (!auth.currentUser) return;
            setBusy("send");
            setError(null);
            try {
              await sendEmailVerification(auth.currentUser, actionCodeSettings);
              setNote("Sent. Check your inbox and spam folder.");
            } catch (e) {
              setError(authErrorMessage(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          Send the link again
        </Button>
        <button className="w-full pt-2 text-center text-sm text-ink-2 hover:text-ink" onClick={() => void signOut()}>
          Use a different account
        </button>
      </div>
    </AuthLayout>
  );
}
