import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from "@firebase/auth";
import { actionCodeSettings, auth, authErrorMessage } from "../../lib/firebase";
import { useAuth } from "../../auth/AuthProvider";
import { Button, ErrorNote, Field, Input } from "../../components/ui";
import { AuthLayout, Divider, GoogleButton, safeNext } from "./AuthLayout";

export default function SignUp() {
  const { firebaseUser } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (firebaseUser) return <Navigate to={next} replace />;

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Use the email address your property manager invited."
      footer={
        <>
          Already have an account?{" "}
          <Link className="font-semibold text-primary hover:underline" to={`/signin${params.toString() ? `?${params}` : ""}`}>
            Sign in
          </Link>
        </>
      }
    >
      {error && <div className="mb-5"><ErrorNote>{error}</ErrorNote></div>}
      <GoogleButton label="Sign up with Google" onError={setError} onDone={() => navigate(next)} />
      <Divider />
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password.length < 8) return setError("Use at least 8 characters for your password.");
          setBusy(true);
          setError(null);
          try {
            const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
            if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
            await sendEmailVerification(cred.user, { ...actionCodeSettings, url: `${actionCodeSettings.url}?next=${encodeURIComponent(next)}` });
            navigate(next);
          } catch (err) {
            setError(authErrorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Full name">{(id) => <Input id={id} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password" hint="At least 8 characters.">
          {(id) => <Input id={id} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
