/**
 * Where the online features live: the Firebase project (accounts and the Firestore database) and the game server
 * on Cloud Run. A Firebase web config is public by design; access is controlled by firestore.rules and the
 * server's token checks.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCpaXNdAnDzdQP6APA7ZQ-4CxAfzeQgr6w',
  authDomain: 'hidden-value-online-xri7.firebaseapp.com',
  projectId: 'hidden-value-online-xri7',
  appId: '1:1080178934383:web:cd7a78c3f1b00e9685839a',
};

export const GAME_SERVER_URL = 'https://game-server-1080178934383.us-central1.run.app';
