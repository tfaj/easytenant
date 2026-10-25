import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { sendPasswordResetEmail } from "@firebase/auth";
import { actionCodeSettings, auth, authErrorMessage } from "../../lib/firebase";
import { Button, ErrorNote, Field, Input } from "../../components/ui";
import { AuthLayout } from "./AuthLayout";

export default function ForgotPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthLayout
      title="Reset your password"
      subtitle={sent ? undefined : "We'll email you a link to choose a new one."}
      footer={<Link to="/signin" className="font-semibold text-primary hover:underline">Back to sign in</Link>}
    >
      {sent ? (
        <div className="rounded-lg border border-line bg-panel p-5">
          <p className="font-semibold">Check your inbox</p>
          <p className="mt-1 text-sm text-ink-2">If an account uses {email}, a reset link is on its way. It can take a minute, and it may land in spam.</p>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await sendPasswordResetEmail(auth, email.trim(), actionCodeSettings);
              setSent(true);
            } catch (err) {
              // Don't reveal whether the account exists.
              if ((err as { code?: string }).code === "auth/user-not-found") setSent(true);
              else setError(authErrorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <ErrorNote>{error}</ErrorNote>}
          <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
