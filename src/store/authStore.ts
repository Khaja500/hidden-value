/**
 * The signed-in account (email and password, through Firebase Auth). Firebase is loaded after the first render,
 * so `status` starts as 'loading'. Every action throws an Error with a message that can be shown as it is.
 */
import { create } from 'zustand';

export interface AuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
}

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: AuthUser | null;
  /** True while a new account's profile is being written, so nothing acts on the half-made account. */
  signingUp: boolean;
  init: () => void;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Re-reads the account, e.g. after the player clicks the link in the verification email. */
  refresh: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
}

const fb = () => import('../online/firebase');
const authSdk = () => import('firebase/auth');
const storeSdk = () => import('firebase/firestore');

const MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Choose a password of at least 6 characters.',
  'auth/email-already-in-use': 'There is already an account with that email. Sign in instead.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
  'auth/user-disabled': 'This account has been disabled.',
};

function friendly(e: unknown): Error {
  const code = (e as { code?: string }).code;
  return new Error((code && MESSAGES[code]) || (e as Error).message || 'Something went wrong');
}

async function guard<T>(p: () => Promise<T>): Promise<T> {
  try {
    return await p();
  } catch (e) {
    throw friendly(e);
  }
}

let started = false;

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  signingUp: false,

  init: () => {
    if (started) return;
    started = true;
    void Promise.all([fb(), authSdk(), storeSdk()])
      .then(([{ auth, db }, { onAuthStateChanged }, { doc, getDoc }]) => {
        onAuthStateChanged(auth, (u) => {
          if (!u) return set({ status: 'signedOut', user: null });
          const base = {
            uid: u.uid,
            email: u.email ?? '',
            emailVerified: u.emailVerified,
            displayName: u.displayName || (u.email ?? 'Player').split('@')[0],
          };
          set({ status: 'signedIn', user: base });
          // The profile document holds the name the other players see.
          void getDoc(doc(db, 'users', u.uid))
            .then((snap) => {
              const name = snap.get('displayName') as string | undefined;
              if (name && get().user?.uid === u.uid) set({ user: { ...get().user!, displayName: name } });
            })
            .catch(() => {});
        });
      })
      .catch(() => set({ status: 'signedOut', user: null }));
  },

  signUp: (email, password, name) =>
    guard(async () => {
      set({ signingUp: true });
      try {
        const [{ auth, db }, a, s] = await Promise.all([fb(), authSdk(), storeSdk()]);
        const cred = await a.createUserWithEmailAndPassword(auth, email.trim(), password);
        const displayName = name.trim().slice(0, 16) || (email.split('@')[0] ?? 'Player').slice(0, 16);
        await a.updateProfile(cred.user, { displayName });
        await s.setDoc(s.doc(db, 'users', cred.user.uid), {
          displayName,
          email: cred.user.email,
          createdAt: Date.now(),
        });
        const user = get().user;
        if (user?.uid === cred.user.uid) set({ user: { ...user, displayName } });
        await a.sendEmailVerification(cred.user);
      } finally {
        set({ signingUp: false });
      }
    }),

  signIn: (email, password) =>
    guard(async () => {
      const [{ auth }, a] = await Promise.all([fb(), authSdk()]);
      await a.signInWithEmailAndPassword(auth, email.trim(), password);
    }),

  signOut: () =>
    guard(async () => {
      const [{ auth }, a] = await Promise.all([fb(), authSdk()]);
      await a.signOut(auth);
    }),

  resetPassword: (email) =>
    guard(async () => {
      const [{ auth }, a] = await Promise.all([fb(), authSdk()]);
      await a.sendPasswordResetEmail(auth, email.trim());
    }),

  resendVerification: () =>
    guard(async () => {
      const [{ auth }, a] = await Promise.all([fb(), authSdk()]);
      if (auth.currentUser) await a.sendEmailVerification(auth.currentUser);
    }),

  refresh: () =>
    guard(async () => {
      const { auth } = await fb();
      const u = auth.currentUser;
      if (!u) return;
      await u.reload();
      const user = get().user;
      if (user) set({ user: { ...user, emailVerified: u.emailVerified } });
    }),

  setDisplayName: (name) =>
    guard(async () => {
      const displayName = name.replace(/\s+/g, ' ').trim().slice(0, 16);
      if (!displayName) throw new Error('Enter a name');
      const [{ auth, db }, a, s] = await Promise.all([fb(), authSdk(), storeSdk()]);
      const u = auth.currentUser;
      if (!u) throw new Error('Sign in first');
      await a.updateProfile(u, { displayName });
      await s.setDoc(s.doc(db, 'users', u.uid), { displayName, email: u.email }, { merge: true });
      const user = get().user;
      if (user) set({ user: { ...user, displayName } });
    }),
}));

/** The current user's ID token, for the game server. */
export async function idToken(): Promise<string> {
  const { auth } = await fb();
  if (!auth.currentUser) throw new Error('Sign in to play online');
  return auth.currentUser.getIdToken();
}
