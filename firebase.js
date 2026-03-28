const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, child, remove, push, onValue, serverTimestamp, query, orderByChild, equalTo } = require('firebase/database');

const firebaseConfig = {
  apiKey: "AIzaSyBScBRNNMxj1RqQtTy2V1PkmBBqb0ed4rA",
  authDomain: "lagacode-c30bf.firebaseapp.com",
  projectId: "lagacode-c30bf",
  storageBucket: "lagacode-c30bf.firebasestorage.app",
  messagingSenderId: "414251734880",
  appId: "1:414251734880:web:095a38b98bd029c87ab005"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// ডাটাবেস রুট রেফারেন্স
const dbRef = ref(database);

// এক্সপোর্ট করা হচ্ছে
module.exports = {
  database,
  dbRef,
  ref,      // নতুন রেফারেন্স তৈরি করতে
  set,      // ডাটা সেট করতে
  get,      // ডাটা পড়তে
  child,    // চাইল্ড নোড অ্যাক্সেস করতে
  remove,   // ডাটা ডিলিট করতে
  push,     // নতুন আইডি তৈরি করতে
  query,    // কোয়েরি করতে
  orderByChild,
  equalTo,
  serverTimestamp
};
