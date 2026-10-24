import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { applyActionCode, checkActionCode, confirmPasswordReset, verifyPasswordResetCode } from "@firebase/auth";
import { auth, authErrorMessage } from "../../lib/firebase";
import { useAuth } from "../../auth/AuthProvider";
import { Button, ButtonLink, ErrorNote, Field, Input, Spinner } from "../../components/ui";
import { AuthLayout, safeNext } from "./AuthLayout";

/** Handles the links Firebase emails: verify email, reset password,
 * recover email. Configured as the action URL in the Firebase console. */
export default function AuthAction() {
  const [params] = useSearchParams();
  const mode = params.get("mode");
  const code = params.get("oobCode") ?? "";
  const next = safeNext(params.get("next") ?? new URL(params.get("continueUrl") ?? "http://x/").searchParams.get("next"));
  if (mode === "resetPassword") return <Reset code={code} />;
  if (mode === "verifyEmail" || mode === "recoverEmail") return <Apply code={code} mode={mode} next={next} />;
  return (
    <AuthLayout title="This link isn't complete" subtitle="Open the most recent email from EasyTenant and use its link.">
      <ButtonLink to="/signin" variant="primary">Go to sign in</ButtonLink>
    </AuthLayout>
  );
}

function Apply({ code, mode, next }: { code: string; mode: "verifyEmail" | "recoverEmail"; next: string }) {
  const { refreshVerification } = useAuth();
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (mode === "recoverEmail") await checkActionCode(auth, code);
        await applyActionCode(auth, code);
        if (auth.currentUser) await refreshVerification();
        if (live) setState("done");
      } catch (e) {
        if (live) {
          setError(authErrorMessage(e));
          setState("error");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [code, mode, refreshVerification]);

  if (state === "working") return <AuthLayout title="One moment"><Spinner label="Confirming" /></AuthLayout>;
  if (state === "error") return <AuthLayout title="That link didn't work"><ErrorNote>{error}</ErrorNote></AuthLayout>;
  return (
    <AuthLayout title={mode === "verifyEmail" ? "Email verified" : "Email restored"} subtitle="You're all set.">
      <ButtonLink to={auth.currentUser ? next : `/signin?next=${encodeURIComponent(next)}`} variant="primary">
        Continue
      </ButtonLink>
    </AuthLayout>
  );
}

function Reset({ code }: { code: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    verifyPasswordResetCode(auth, code).then(setEmail, (e) => setError(authErrorMessage(e)));
  }, [code]);
  if (error && !email) return <AuthLayout title="That link didn't work"><ErrorNote>{error}</ErrorNote><div className="mt-5"><Link className="font-semibold text-primary" to="/forgot-password">Request a new link</Link></div></AuthLayout>;
  if (!email) return <AuthLayout title="One moment"><Spinner /></AuthLayout>;
  return (
    <AuthLayout title="Choose a new password" subtitle={`For ${email}`}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password.length < 8) return setError("Use at least 8 characters.");
          setBusy(true);
          try {
            await confirmPasswordReset(auth, code, password);
            navigate(`/signin?email=${encodeURIComponent(email)}`);
          } catch (err) {
            setError(authErrorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="New password" hint="At least 8 characters.">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Save password
        </Button>
      </form>
    </AuthLayout>
  );
}
