/**
 * Genera icon.png, icon.ico y assets AppX / Microsoft Store
 * desde build/icon-master-src.jpg (o .png).
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default || require("png-to-ico");

const root = path.join(__dirname, "..");
const buildDir = path.join(root, "build");
const appxDir = path.join(buildDir, "appx");
const srcCandidates = [
  path.join(buildDir, "icon-master-src.png"),
  path.join(buildDir, "icon-master-src.jpg"),
];

async function main() {
  const src = srcCandidates.find((p) => fs.existsSync(p));
  if (!src) {
    throw new Error("No está build/icon-master-src.png ni .jpg");
  }

  fs.mkdirSync(appxDir, { recursive: true });

  // Master cuadrado 1024 PNG (base de todo)
  const master1024 = path.join(buildDir, "icon.png");
  await sharp(src)
    .resize(1024, 1024, { fit: "cover" })
    .png()
    .toFile(master1024);
  console.log("✓ build/icon.png (1024)");

  // Tamaños para .ico (Windows)
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngs = [];
  for (const size of icoSizes) {
    const out = path.join(buildDir, `icon-${size}.png`);
    await sharp(master1024).resize(size, size).png().toFile(out);
    icoPngs.push(out);
  }
  const icoBuf = await pngToIco(icoPngs);
  fs.writeFileSync(path.join(buildDir, "icon.ico"), icoBuf);
  console.log("✓ build/icon.ico");

  // Assets Microsoft Store / AppX
  // https://www.electron.build/configuration/appx
  const appxAssets = [
    { name: "StoreLogo.png", w: 50, h: 50 },
    { name: "Square44x44Logo.png", w: 44, h: 44 },
    { name: "Square71x71Logo.png", w: 71, h: 71 },
    { name: "Square150x150Logo.png", w: 150, h: 150 },
    { name: "Square310x310Logo.png", w: 310, h: 310 },
    { name: "Wide310x150Logo.png", w: 310, h: 150 },
    { name: "SplashScreen.png", w: 620, h: 300 },
  ];

  for (const asset of appxAssets) {
    const out = path.join(appxDir, asset.name);
    if (asset.w === asset.h) {
      await sharp(master1024).resize(asset.w, asset.h).png().toFile(out);
    } else {
      // Wide / splash: fondo naranja + icono centrado
      const iconSize = Math.round(Math.min(asset.w, asset.h) * 0.72);
      const iconBuf = await sharp(master1024).resize(iconSize, iconSize).png().toBuffer();
      await sharp({
        create: {
          width: asset.w,
          height: asset.h,
          channels: 3,
          background: { r: 255, g: 106, b: 0 },
        },
      })
        .composite([
          {
            input: iconBuf,
            gravity: "centre",
          },
        ])
        .png()
        .toFile(out);
    }
    console.log(`✓ build/appx/${asset.name}`);
  }

  // Copias útiles para Partner Center (capturas / listing)
  const storeDir = path.join(root, "store", "assets");
  fs.mkdirSync(storeDir, { recursive: true });
  await sharp(master1024).resize(512, 512).png().toFile(path.join(storeDir, "logo-512.png"));
  await sharp(master1024).resize(300, 300).png().toFile(path.join(storeDir, "logo-300.png"));
  console.log("✓ store/assets/logo-512.png, logo-300.png");

  // Copia al paquete Electron (icono de ventana en runtime) + favicon web
  const electronDir = path.join(root, "electron");
  const publicDir = path.join(root, "public");
  fs.copyFileSync(path.join(buildDir, "icon.ico"), path.join(electronDir, "icon.ico"));
  fs.copyFileSync(master1024, path.join(electronDir, "icon.png"));
  fs.copyFileSync(master1024, path.join(publicDir, "icon.png"));
  console.log("✓ electron/icon.ico, icon.png + public/icon.png");

  // limpia png intermedios del ico
  for (const p of icoPngs) fs.unlinkSync(p);
  console.log("Listo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
