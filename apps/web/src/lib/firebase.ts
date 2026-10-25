import { initializeApp } from "@firebase/app";
import { browserLocalPersistence, getAuth, GoogleAuthProvider, setPersistence } from "@firebase/auth";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/** Where Firebase email links (verify, reset) send people back to. */
export const actionCodeSettings = {
  url: `${import.meta.env.VITE_APP_URL ?? window.location.origin}/auth/action`,
  handleCodeInApp: true,
};

/** Firebase error codes in words a person can act on. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const messages: Record<string, string> = {
    "auth/invalid-credential": "That email and password don't match.",
    "auth/wrong-password": "That email and password don't match.",
    "auth/user-not-found": "No account uses that email.",
    "auth/email-already-in-use": "An account already uses that email. Sign in instead.",
    "auth/weak-password": "Use at least 8 characters.",
    "auth/invalid-email": "That email address isn't valid.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/popup-closed-by-user": "The Google window was closed before signing in.",
    "auth/network-request-failed": "No connection. Check your network and try again.",
    "auth/expired-action-code": "This link has expired. Request a new one.",
    "auth/invalid-action-code": "This link has already been used or is invalid.",
  };
  return messages[code] ?? "Something went wrong. Try again.";
}
