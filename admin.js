const admin = require("firebase-admin");
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  "./serviceAccountKey.json");

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

// Function to set user role
async function setUserRole(uid, role) {
  try {
    await admin.auth().setCustomUserClaims(uid, { role: role });
    console.log(`Role ${role} set for user ${uid}`);
    return { success: true, message: `Role ${role} assigned successfully` };
  } catch (error) {
    console.error("Error setting custom claims:", error);
    throw error;
  }
}

// Function to get user with claims
async function getUserWithClaims(uid) {
  try {
    const user = await admin.auth().getUser(uid);
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      claims: user.customClaims || {},
    };
  } catch (error) {
    console.error("Error getting user claims:", error);
    throw error;
  }
}

// Function to verify ID token and get claims
async function verifyToken(idToken) {
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error("Error verifying token:", error);
    throw error;
  }
}

module.exports = { setUserRole, getUserWithClaims, verifyToken, admin };
