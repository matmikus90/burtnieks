const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { patchServer, patchInterface } = require("./runtime-patches");
const { patchAchievementServer, patchAchievementInterface } = require("./achievement-patches");

function materializeBundle(bundlePath, targetPath, transform = (source) => source) {
  const encoded = fs.readFileSync(bundlePath, "utf8").trim();
  const bundledSource = zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
  const decoded = Buffer.from(transform(bundledSource), "utf8");

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath) && fs.readFileSync(targetPath).equals(decoded)) return;

  const temporaryPath = `${targetPath}.tmp`;
  fs.writeFileSync(temporaryPath, decoded);
  fs.renameSync(temporaryPath, targetPath);
}

function localizeBoardMultipliers(source) {
  return source
    .replaceAll('label[y][x] = "TW";', 'label[y][x] = "3V";')
    .replaceAll('label[y][x] = (x===7&&y===7) ? "★" : "DW";', 'label[y][x] = (x===7&&y===7) ? "★" : "2V";')
    .replaceAll('label[y][x] = "TL";', 'label[y][x] = "3B";')
    .replaceAll('label[y][x] = "DL";', 'label[y][x] = "2B";')
    .replaceAll('.cell[data-m=TW]', '.cell[data-m="3V"]')
    .replaceAll('.cell[data-m=DW]', '.cell[data-m="2V"]')
    .replaceAll('.cell[data-m=TL]', '.cell[data-m="3B"]')
    .replaceAll('.cell[data-m=DL]', '.cell[data-m="2B"]');
}

const runtimeServer = path.join(__dirname, ".runtime-server.js");
const runtimeInterface = path.join(__dirname, "public", "app.html");

materializeBundle(
  path.join(__dirname, "server.bundle.gz.b64"),
  runtimeServer,
  (source) => patchAchievementServer(patchServer(localizeBoardMultipliers(source)))
);
materializeBundle(
  path.join(__dirname, "public", "index.bundle.gz.b64"),
  runtimeInterface,
  (source) => patchAchievementInterface(patchInterface(localizeBoardMultipliers(source)))
);

require(runtimeServer);