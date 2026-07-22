const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function materializeBundle(bundlePath, targetPath) {
  const encoded = fs.readFileSync(bundlePath, "utf8").trim();
  const decoded = zlib.gunzipSync(Buffer.from(encoded, "base64"));

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath) && fs.readFileSync(targetPath).equals(decoded)) return;

  const temporaryPath = `${targetPath}.tmp`;
  fs.writeFileSync(temporaryPath, decoded);
  fs.renameSync(temporaryPath, targetPath);
}

const runtimeServer = path.join(__dirname, ".runtime-server.js");
const runtimeInterface = path.join(__dirname, "public", "app.html");

materializeBundle(path.join(__dirname, "server.bundle.gz.b64"), runtimeServer);
materializeBundle(path.join(__dirname, "public", "index.bundle.gz.b64"), runtimeInterface);

require(runtimeServer);
