import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { TokenVerifier } from "./verifier";

/**
 * Firebase Admin is used only to verify ID tokens. Verification needs the
 * project id and Google's public signing keys, not a private key, so on
 * Cloud Run no service-account JSON is required.
 */
export function firebaseVerifier(opts: { projectId?: string; serviceAccountJson?: string }): TokenVerifier {
  let app: App;
  if (getApps().length) {
    app = getApps()[0]!;
  } else if (opts.serviceAccountJson) {
    app = initializeApp({ credential: cert(JSON.parse(opts.serviceAccountJson)), projectId: opts.projectId });
  } else {
    app = initializeApp({ projectId: opts.projectId });
  }
  const auth = getAuth(app);

  return {
    async verify(token) {
      try {
        const d = await auth.verifyIdToken(token);
        if (!d.email) return null;
        return {
          uid: d.uid,
          email: d.email.toLowerCase(),
          emailVerified: d.email_verified === true,
          name: typeof d.name === "string" ? d.name : undefined,
        };
      } catch {
        return null;
      }
    },
  };
}
