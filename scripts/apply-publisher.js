/**
 * Lee store/publisher.json y escribe build/appx-identity.json
 * usado por electron-builder (extraMetadata / env).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pubPath = path.join(root, "store", "publisher.json");
const pub = JSON.parse(fs.readFileSync(pubPath, "utf8"));

const required = ["identityName", "publisher", "publisherDisplayName", "applicationId", "displayName"];
for (const key of required) {
  if (!pub[key] || String(pub[key]).includes("REPLACE")) {
    console.warn(
      `[aviso] store/publisher.json → "${key}" aún es placeholder. ` +
        `El build de Store fallará o no será aceptado hasta que lo completes.`
    );
  }
}

const out = {
  identityName: pub.identityName,
  publisher: pub.publisher,
  publisherDisplayName: pub.publisherDisplayName,
  applicationId: pub.applicationId,
  displayName: pub.displayName,
};

fs.mkdirSync(path.join(root, "build"), { recursive: true });
fs.writeFileSync(path.join(root, "build", "appx-identity.json"), JSON.stringify(out, null, 2));
console.log("✓ build/appx-identity.json");
