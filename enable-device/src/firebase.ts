import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyDzFIs4dAO_fjmMCBv4W_JjCUQ4mGCVy_0",
  authDomain: "enableitalia.firebaseapp.com",
  projectId: "enableitalia",
  storageBucket: "enableitalia.firebasestorage.app",
  messagingSenderId: "615392055186",
  appId: "1:615392055186:web:1f4dc031b813341cd5bb4b",
  measurementId: "G-YGBEL4YXFF"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const functions = getFunctions(app, "europe-west1");
