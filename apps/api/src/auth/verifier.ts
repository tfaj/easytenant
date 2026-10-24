export interface VerifiedToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/** Verifies a Firebase ID token. An interface so tests can swap in a fake. */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken | null>;
}
