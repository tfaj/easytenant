import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { signInWithEmailAndPassword } from "@firebase/auth";
import { auth, authErrorMessage } from "../../lib/firebase";
import { useAuth } from "../../auth/AuthProvider";
import { Button, ErrorNote, Field, Input } from "../../components/ui";
import { AuthLayout, Divider, GoogleButton, safeNext } from "./AuthLayout";

export default function SignIn() {
  const { firebaseUser } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (firebaseUser) return <Navigate to={next} replace />;

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back."
      footer={
        <>
          New here?{" "}
          <Link className="font-semibold text-primary hover:underline" to={`/signup${params.toString() ? `?${params}` : ""}`}>
            Create an account
          </Link>
        </>
      }
    >
      {error && <div className="mb-5"><ErrorNote>{error}</ErrorNote></div>}
      <GoogleButton onError={setError} onDone={() => navigate(next)} />
      <Divider />
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await signInWithEmailAndPassword(auth, email.trim(), password);
            navigate(next);
          } catch (err) {
            setError(authErrorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">
          {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="flex justify-end">
          <Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="text-[13px] font-semibold text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
