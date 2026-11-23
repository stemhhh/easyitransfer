/**
 * Build AppX/MSIX listo para Partner Center.
 * Requiere store/publisher.json con la identidad real de Microsoft Store.
 */
const fs = require("fs");
const path = require("path");
const { build, Platform } = require("electron-builder");

const root = path.join(__dirname, "..");

require("./apply-publisher.js");
const identity = JSON.parse(
  fs.readFileSync(path.join(root, "build", "appx-identity.json"), "utf8")
);

const incomplete = Object.values(identity).some((v) => String(v).includes("REPLACE"));
if (incomplete) {
  console.error("\nCompleta store/publisher.json con los datos de Partner Center antes de build:store.\n");
  console.error("Guía: store/PARTNER_CENTER.txt\n");
  process.exit(1);
}

async function main() {
  await build({
    targets: Platform.WINDOWS.createTarget("appx", "x64"),
    config: {
      appId: "com.easyitransfer.app",
      productName: "Easy iTransfer",
      copyright: `Copyright © ${new Date().getFullYear()} ${identity.publisherDisplayName}`,
      directories: { output: "dist", buildResources: "build" },
      files: ["electron/**/*", "public/**/*", "server.js", "package.json"],
      asar: true,
      icon: "build/icon.ico",
      win: {
        icon: "build/icon.ico",
        target: ["appx"],
      },
      appx: {
        identityName: identity.identityName,
        publisher: identity.publisher,
        publisherDisplayName: identity.publisherDisplayName,
        applicationId: identity.applicationId,
        displayName: identity.displayName,
        languages: ["es-es", "en-us"],
        showNameOnTiles: true,
        setBuildNumber: true,
        backgroundColor: "#FF6A00",
      },
    },
  });
  console.log("\n✓ Paquete Store generado en dist/\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
