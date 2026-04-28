// core/config.js — 全域常數
export const BACKEND_HOST = 'phubbing-backend-798458690617.asia-east1.run.app';

export const isSecure = window.location.protocol === 'https:';
export const HTTP_PROTOCOL = isSecure ? 'https://' : 'http://';
export const WS_PROTOCOL = isSecure ? 'wss://' : 'ws://';

export const firebaseConfig = {
    apiKey: "AIzaSyBD_Q2H2H7HalmKV2A4TT1I2J9md9Mtq3k",
    authDomain: "graduation-6ae65.firebaseapp.com",
    projectId: "graduation-6ae65",
    storageBucket: "graduation-6ae65.firebasestorage.app",
    messagingSenderId: "798458690617",
    appId: "1:798458690617:web:bda0f994b531be1f4461e8",
    measurementId: "G-8STMGY1K1C"
};
