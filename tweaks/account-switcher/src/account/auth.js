function emailFromAuthString(raw) {
  try {
    return emailFromAuth(JSON.parse(raw));
  } catch {
    return null;
  }
}

function emailFromAuth(auth) {
  const direct = auth?.email || auth?.user?.email || auth?.account?.email;
  if (typeof direct === "string" && direct.includes("@")) return direct;

  const idToken = auth?.tokens?.id_token;
  if (typeof idToken !== "string") return null;
  const [, payload] = idToken.split(".");
  if (!payload) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims.email === "string" && claims.email.includes("@") ? claims.email : null;
  } catch {
    return null;
  }
}

module.exports = { emailFromAuthString, emailFromAuth };
