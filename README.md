# Easy iTransfer

Transfiere archivos entre tu PC y el iPhone (u otros dispositivos) en la misma Wi‑Fi. Crea un grupo, escanea el QR y envía sin límite de tamaño. Sin internet ni cuentas.

## Descargar

- Instalador Windows: [Releases](https://github.com/stemhhh/easyitransfer/releases/latest)
- Sitio: desplegado en Cloudflare Workers (`easyitransfer-site`)

## Desarrollo

```bash
npm install
npm start          # app Electron
npm run server     # solo servidor web
npm run build:exe  # instalador NSIS
npm run icons      # regenerar iconos
```

## Microsoft Store

Ver `store/PARTNER_CENTER.txt` y completa `store/publisher.json` (desde el example) antes de `npm run build:store`.
