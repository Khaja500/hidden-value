/**
 * The Firebase app and its services. This module (and the Firebase SDK) is only loaded on demand, after the first
 * render, so the single-player game never waits for it.
 */
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { FIREBASE_CONFIG } from './config';

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
